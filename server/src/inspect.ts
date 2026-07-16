import "dotenv/config";
import { TxLine } from "./txline";

(async () => {
  const tx = new TxLine(process.env.TXLINE_API_TOKEN!);
  await tx.init();
  const arg = process.argv[2];
  if (!arg) {
    const f = await tx.fixtures();
    console.log(`fixtures: ${f.length}`);
    console.log(JSON.stringify(f, null, 2));
    return;
  }
  const id = Number(arg);
  const odds = await tx.odds(id);
  console.log(`total odds entries: ${odds.length}`);

  const types: Record<string, number> = {};
  for (const o of odds) {
    const key = `${o.SuperOddsType} | period=${o.MarketPeriod} | params=${o.MarketParameters} | names=${JSON.stringify(o.PriceNames)}`;
    types[key] = (types[key] ?? 0) + 1;
  }
  console.log("MARKET TYPES:");
  for (const [k, v] of Object.entries(types)) console.log(`  [${v}x] ${k}`);

  const ml = odds.filter((o: any) =>
    /MONEYLINE|1X2|MATCH|WIN/i.test(o.SuperOddsType ?? "") ||
    (o.PriceNames?.length === 3));
  console.log(`\nMONEYLINE-LIKE ENTRIES (latest 3 of ${ml.length}):`);
  console.log(JSON.stringify(ml.slice(-3), null, 2));

  const scores = await tx.scores(id);
  console.log(`\nscores entries: ${scores.length}, latest 2:`);
  console.log(JSON.stringify(scores.slice(-2), null, 2));
})();
