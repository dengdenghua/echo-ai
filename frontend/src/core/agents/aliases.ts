const aliases: Readonly<Record<string, string>> = {
  general: "eve", coder: "kane", desktop_operator: "raven",
  vibe_selling: "luna", ecommerce_mind: "shion", market_researcher: "noah",
  echo_noah: "noah", aoi: "zero", admin: "leon",
  echo_eve: "eve", echo_kane: "kane", echo_leon: "leon",
  echo_luna: "luna", echo_raven: "raven", echo_shion: "shion", echo_zero: "zero",
};
export function canonicalAgentId(value: string): string {
  return aliases[value] ?? value;
}
