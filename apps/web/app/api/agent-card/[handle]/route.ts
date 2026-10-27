import { api, isNotFound } from "@/lib/api";
import { contractAddress } from "@nundina/shared/addresses";
import { config } from "@/lib/config";

const identity = () => {
  try {
    return contractAddress(config.chainId, "IdentityRegistry");
  } catch {
    return "";
  }
};

/** ERC-8004 agent card: the `agentURI` a provider registers in IdentityRegistry. */
export async function GET(_req: Request, ctx: { params: Promise<{ handle: string }> }) {
  const { handle } = await ctx.params;
  try {
    const p = await api.provider(handle);
    const card = {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: p.displayName || p.handle,
      description: p.bio ?? `Trading signals by @${p.handle}, committed on HashKey Chain and settled pay-if-right by Nundina.`,
      image: `${config.siteUrl}/api/og/badge/${encodeURIComponent(p.handle)}`,
      endpoints: [
        { name: "web", endpoint: `${config.siteUrl}/p/${encodeURIComponent(p.handle)}` },
        { name: "api", endpoint: `${config.publicApiUrl}/providers/${encodeURIComponent(p.handle)}` },
        ...(p.channelTitle ? [{ name: "telegram", endpoint: `https://t.me/${config.botUsername}` }] : []),
        { name: "agentWallet", endpoint: `eip155:${config.chainId}:${p.address}` },
      ],
      registrations: p.erc8004Id ? [{ agentId: Number(p.erc8004Id), agentRegistry: `eip155:${config.chainId}:${identity()}` }] : [],
      supportedTrust: ["reputation", "crypto-economic"],
    };
    return Response.json(card, { headers: { "cache-control": "public, max-age=300" } });
  } catch (e) {
    if (isNotFound(e)) return Response.json({ error: "not_found" }, { status: 404 });
    throw e;
  }
}
