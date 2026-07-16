use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("E41gijUM6sbUdCa8Z26m37u8zv13C8B4yRPTkbbKpoTY"); // replace after `anchor keys sync`

pub const MAX_OUTCOMES: usize = 3; // Home / Draw / Away (1X2)
pub const FEE_BPS: u64 = 200; // 2% fee on buys, accrues to market vault for LP/protocol
pub const USDC_DECIMALS: u32 = 6;

#[program]
pub mod oddschain {
    use super::*;

    /// Create a market for a TxLINE fixture. Initial pool balances are seeded
    /// from TxLINE StablePrice odds so opening prices == real market consensus.
    /// `seed_liquidity` USDC is pulled from the creator (the ops wallet) and
    /// distributed across outcome pools inversely proportional to odds.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        fixture_id: u64,
        outcome_count: u8,
        title: String,
        // implied probabilities in basis points, must sum to ~10000 (from TxLINE odds)
        prob_bps: [u16; MAX_OUTCOMES],
        seed_liquidity: u64,
        close_ts: i64,
    ) -> Result<()> {
        require!(outcome_count as usize <= MAX_OUTCOMES && outcome_count >= 2, TxError::BadOutcomeCount);
        require!(title.len() <= 64, TxError::TitleTooLong);
        require!(seed_liquidity > 0, TxError::ZeroAmount);

        let sum: u32 = prob_bps.iter().take(outcome_count as usize).map(|p| *p as u32).sum();
        require!(sum >= 9800 && sum <= 10200, TxError::BadProbabilities);

        let m = &mut ctx.accounts.market;
        m.authority = ctx.accounts.authority.key();
        m.oracle = ctx.accounts.oracle.key();
        m.fixture_id = fixture_id;
        m.outcome_count = outcome_count;
        m.title = title;
        m.close_ts = close_ts;
        m.resolved = false;
        m.winner = u8::MAX;
        m.bump = ctx.bumps.market;
        m.vault_bump = ctx.bumps.vault;

        // FPMM pool seeding: pool_i = L * (1 - p_i) normalized so that
        // price_i = (1/pool_i) / sum(1/pool_j) ≈ p_i at open.
        // Simpler equivalent for FPMM: pool_i inversely proportional to p_i.
        let mut pools = [0u64; MAX_OUTCOMES];
        let mut inv_sum: u128 = 0;
        for i in 0..outcome_count as usize {
            require!(prob_bps[i] > 0, TxError::BadProbabilities);
            inv_sum += 10_000u128 * 10_000 / prob_bps[i] as u128;
        }
        for i in 0..outcome_count as usize {
            let inv = 10_000u128 * 10_000 / prob_bps[i] as u128;
            pools[i] = ((seed_liquidity as u128) * inv / inv_sum) as u64;
            require!(pools[i] > 0, TxError::ZeroAmount);
        }
        m.pools = pools;
        m.total_shares = [0u64; MAX_OUTCOMES];
        m.fees_accrued = 0;

        // pull seed liquidity into vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.creator_usdc.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            seed_liquidity,
        )?;

        emit!(MarketCreated { market: m.key(), fixture_id, outcome_count });
        Ok(())
    }

    /// Buy `outcome` shares by paying `amount_in` USDC (Polymarket-style FPMM).
    /// Invariant: product of pool balances is constant across the trade.
    pub fn buy(ctx: Context<Trade>, outcome: u8, amount_in: u64, min_shares_out: u64) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(!m.resolved, TxError::MarketResolved);
        require!(Clock::get()?.unix_timestamp < m.close_ts, TxError::MarketClosed);
        require!((outcome as usize) < m.outcome_count as usize, TxError::BadOutcome);
        require!(amount_in > 0, TxError::ZeroAmount);

        let fee = amount_in * FEE_BPS / 10_000;
        let a = amount_in - fee;
        m.fees_accrued += fee;

        let n = m.outcome_count as usize;
        let o = outcome as usize;

        // K = product of current pools
        let mut k: u128 = 1;
        for i in 0..n { k = k.checked_mul(m.pools[i] as u128).ok_or(TxError::MathOverflow)?; }

        // add `a` to every pool, then remove x from pool_o to restore K
        // prod_other = product of (pool_i + a) for i != o
        let mut prod_other: u128 = 1;
        for i in 0..n {
            if i != o {
                prod_other = prod_other
                    .checked_mul((m.pools[i] as u128) + a as u128)
                    .ok_or(TxError::MathOverflow)?;
            }
        }
        let new_pool_o = k.checked_div(prod_other).ok_or(TxError::MathOverflow)? + 1; // round up in AMM's favor
        let pool_o_after_add = (m.pools[o] as u128) + a as u128;
        require!(pool_o_after_add > new_pool_o, TxError::MathOverflow);
        let shares_out = (pool_o_after_add - new_pool_o) as u64;
        require!(shares_out >= min_shares_out, TxError::Slippage);

        for i in 0..n {
            if i == o { m.pools[i] = new_pool_o as u64; }
            else { m.pools[i] = m.pools[i] + a; }
        }
        m.total_shares[o] += shares_out;

        // position PDA bookkeeping
        let pos = &mut ctx.accounts.position;
        if pos.owner == Pubkey::default() {
            pos.owner = ctx.accounts.user.key();
            pos.market = m.key();
        }
        pos.shares[o] += shares_out;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.user_usdc.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_in,
        )?;

        emit!(Bought { market: m.key(), user: pos.owner, outcome, amount_in, shares_out });
        Ok(())
    }

    /// Resolve with the winning outcome. Called by the keeper (oracle authority)
    /// after TxLINE reports the fixture final. `txline_ref` stores the score-feed
    /// sequence used, so anyone can audit the resolution against TxLINE's
    /// on-chain-anchored feed. (Roadmap: replace with CPI into txoracle
    /// validate_fixture, same pattern as Final Whistle.)
    pub fn resolve(ctx: Context<Resolve>, winner: u8, txline_ref: u64) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(!m.resolved, TxError::MarketResolved);
        require!((winner as usize) < m.outcome_count as usize, TxError::BadOutcome);
        m.resolved = true;
        m.winner = winner;
        m.txline_ref = txline_ref;
        emit!(Resolved { market: m.key(), winner, txline_ref });
        Ok(())
    }

    /// Winning shares redeem 1:1 for USDC from the vault.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let m = &ctx.accounts.market;
        require!(m.resolved, TxError::NotResolved);
        let pos = &mut ctx.accounts.position;
        let w = m.winner as usize;
        let payout = pos.shares[w];
        require!(payout > 0, TxError::NothingToClaim);
        pos.shares[w] = 0;

        let fixture_bytes = m.fixture_id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"market", fixture_bytes.as_ref(), &[m.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_usdc.to_account_info(),
                    authority: m.to_account_info(),
                },
                &[seeds],
            ),
            payout,
        )?;
        emit!(Claimed { market: m.key(), user: pos.owner, payout });
        Ok(())
    }
}

// ---------- accounts ----------

#[account]
pub struct Market {
    pub authority: Pubkey,
    pub oracle: Pubkey,
    pub fixture_id: u64,
    pub outcome_count: u8,
    pub title: String,          // "France vs Brazil — Semi Final"
    pub pools: [u64; MAX_OUTCOMES],
    pub total_shares: [u64; MAX_OUTCOMES],
    pub fees_accrued: u64,
    pub close_ts: i64,
    pub resolved: bool,
    pub winner: u8,
    pub txline_ref: u64,
    pub bump: u8,
    pub vault_bump: u8,
}
impl Market { pub const SPACE: usize = 8 + 32 + 32 + 8 + 1 + (4 + 64) + 8*3 + 8*3 + 8 + 8 + 1 + 1 + 8 + 1 + 1; }

#[account]
pub struct Position {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub shares: [u64; MAX_OUTCOMES],
}
impl Position { pub const SPACE: usize = 8 + 32 + 32 + 8*3; }

#[derive(Accounts)]
#[instruction(fixture_id: u64)]
pub struct CreateMarket<'info> {
    #[account(init, payer = authority, space = Market::SPACE,
        seeds = [b"market", fixture_id.to_le_bytes().as_ref()], bump)]
    pub market: Account<'info, Market>,
    #[account(init, payer = authority,
        seeds = [b"vault", fixture_id.to_le_bytes().as_ref()], bump,
        token::mint = usdc_mint, token::authority = market)]
    pub vault: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(mut)]
    pub creator_usdc: Account<'info, TokenAccount>,
    /// CHECK: keeper pubkey stored for resolution auth
    pub oracle: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut, seeds = [b"market", market.fixture_id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.fixture_id.to_le_bytes().as_ref()], bump = market.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = user, space = Position::SPACE,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()], bump)]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    #[account(mut, has_one = oracle @ TxError::Unauthorized)]
    pub market: Account<'info, Market>,
    pub oracle: Signer<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(seeds = [b"market", market.fixture_id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.fixture_id.to_le_bytes().as_ref()], bump = market.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"position", market.key().as_ref(), user.key().as_ref()], bump,
        constraint = position.owner == user.key() @ TxError::Unauthorized)]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

// ---------- events & errors ----------

#[event] pub struct MarketCreated { pub market: Pubkey, pub fixture_id: u64, pub outcome_count: u8 }
#[event] pub struct Bought { pub market: Pubkey, pub user: Pubkey, pub outcome: u8, pub amount_in: u64, pub shares_out: u64 }
#[event] pub struct Resolved { pub market: Pubkey, pub winner: u8, pub txline_ref: u64 }
#[event] pub struct Claimed { pub market: Pubkey, pub user: Pubkey, pub payout: u64 }

#[error_code]
pub enum TxError {
    #[msg("Invalid outcome count")] BadOutcomeCount,
    #[msg("Title too long")] TitleTooLong,
    #[msg("Probabilities must sum to ~10000 bps")] BadProbabilities,
    #[msg("Zero amount")] ZeroAmount,
    #[msg("Invalid outcome index")] BadOutcome,
    #[msg("Market already resolved")] MarketResolved,
    #[msg("Market not resolved yet")] NotResolved,
    #[msg("Market closed for trading")] MarketClosed,
    #[msg("Slippage exceeded")] Slippage,
    #[msg("Math overflow")] MathOverflow,
    #[msg("Unauthorized")] Unauthorized,
    #[msg("Nothing to claim")] NothingToClaim,
}
