import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../api/src/db/client.js";
import { providers, users } from "../../api/src/db/schema.js";
import { stopQueue } from "../../api/src/jobs/queue.js";
import { redeemOnWeb, startLinkFromWeb } from "../../api/src/services/telegramAccount.js";
import { makeProvider } from "../../api/test/helpers.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recheckChannels } from "../src/channels.js";
import { BOT_INFO, harness, telegramProvider } from "./harness.js";

// ids no other test file uses (they share one database)
let nextTg = 61000;
let nextChat = -1006100000;

async function provider(name: string) {
  const tg = nextTg++;
  const p = await telegramProvider(tg);
  const handle = `${name.toLowerCase().replace(/\W/g, "")}_${tg}`;
  await db().update(providers).set({ displayName: name, handle }).where(eq(providers.id, p.providerId));
  return { ...p, handle, tg };
}
const row = (id: number) => db().query.providers.findFirst({ where: eq(providers.id, id) });

describe("channel verification", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });
  afterAll(async () => {
    await stopQueue();
    await closeDb();
  });

  it("adding the bot as admin verifies the owner's channel in one step", async () => {
    const p = await provider("Zephyr Quant");
    const chat = nextChat--;
    h.channel.title = "Zephyr Quant Calls";
    h.channel.username = "zephyrquant";
    h.channel.admins = [{ id: p.tg, status: "creator" }];
    await h.myChatMember(chat, p.tg, "left", "administrator");

    const r = await row(p.providerId);
    expect(r).toMatchObject({ channelId: chat, channelUsername: "zephyrquant", channelMembers: 1200, channelRole: "creator", lookalikeOf: null });
    expect(r!.channelVerifiedAt).toBeInstanceOf(Date);
    expect(h.sent(chat).at(-1)!.payload.text).toMatch(/verified on Nundina<\/b> as @zephyrquant_/);
    expect(h.sent(p.tg).at(-1)!.payload.text).toMatch(/you're its owner · 1200 subscribers/);
  });

  it("someone who isn't on the channel's admin list can't claim it", async () => {
    const p = await provider("Kestrel Flow");
    const chat = nextChat--;
    h.channel.admins = [{ id: 1, status: "creator" }]; // Telegram says someone else owns it
    await h.myChatMember(chat, p.tg, "left", "administrator");
    expect((await row(p.providerId))!.channelId).toBeNull();
    expect(h.sent(p.tg).at(-1)!.payload.text).toMatch(/doesn't list your account/);
  });

  it("a channel belongs to one provider; an admin of it can't take it over", async () => {
    const owner = await provider("Orchid Desk");
    const admin = await provider("Basalt Trades");
    const chat = nextChat--;
    h.channel.admins = [
      { id: owner.tg, status: "creator" },
      { id: admin.tg, status: "administrator" },
    ];
    await h.myChatMember(chat, owner.tg, "left", "administrator");
    await h.myChatMember(chat, admin.tg, "administrator", "administrator", true);
    // a demote/promote of the bot by the second admin
    await h.myChatMember(chat, admin.tg, "member", "administrator");
    expect((await row(owner.providerId))!.channelId).toBe(chat);
    expect((await row(admin.providerId))!.channelId).toBeNull();
    expect(h.sent(admin.tg).at(-1)!.payload.text).toMatch(/already verified by @orchiddesk_/);
  });

  it("a later channel copying an established name is flagged as a lookalike", async () => {
    const real = await provider("Saffron Whale");
    h.channel.title = "Saffron Whale";
    h.channel.username = "saffronwhale";
    h.channel.admins = [{ id: real.tg, status: "creator" }];
    await h.myChatMember(nextChat--, real.tg, "left", "administrator");

    const fake = await provider("Fresh Account");
    h.channel.title = "Saffr0n Whale OFFICIAL";
    h.channel.username = "saffronwhale_vip";
    h.channel.admins = [{ id: fake.tg, status: "creator" }];
    await h.myChatMember(nextChat--, fake.tg, "left", "administrator");

    expect((await row(fake.providerId))!.lookalikeOf).toBe(real.handle);
    expect((await row(real.providerId))!.lookalikeOf).toBeNull();
    expect(h.sent(fake.tg).at(-1)!.payload.text).toMatch(/looks a lot like @saffronwhale_/);
  });

  it("someone who isn't a provider is told how to become one", async () => {
    await h.myChatMember(nextChat--, 60999, "left", "administrator");
    expect(h.sent(60999).at(-1)!.payload.text).toMatch(/isn't linked to a Nundina provider profile/);
  });

  it("asks for the post right when the bot was added without it", async () => {
    const p = await provider("Cobalt Signals");
    await h.myChatMember(nextChat--, p.tg, "left", "administrator", false);
    expect(h.sent(p.tg).at(-1)!.payload.text).toMatch(/without the “Post messages” right/);
  });

  it("removing the bot unlinks the channel", async () => {
    const p = await provider("Juniper Tape");
    const chat = nextChat--;
    h.channel.admins = [{ id: p.tg, status: "creator" }];
    await h.myChatMember(chat, p.tg, "left", "administrator");
    await h.myChatMember(chat, p.tg, "administrator", "left");
    const r = await row(p.providerId);
    expect(r!.channelId).toBeNull();
    expect(r!.channelVerifiedAt).toBeNull();
    expect(h.sent(p.tg).at(-1)!.payload.text).toMatch(/no longer verified/);
  });

  it("the periodic re-check drops a channel the provider no longer admins", async () => {
    const p = await provider("Umber Range");
    const chat = nextChat--;
    h.channel.admins = [{ id: p.tg, status: "creator" }];
    await h.myChatMember(chat, p.tg, "left", "administrator");

    h.channel.admins = [{ id: 2, status: "creator" }]; // channel sold
    await recheckChannels(h.deps, h.bot.api, BOT_INFO.id);
    expect((await row(p.providerId))!.channelId).toBeNull();
    expect(h.sent(p.tg).at(-1)!.payload.text).toMatch(/no longer its owner or an admin/);
  });

  it("the re-check refreshes subscriber counts of channels that are still fine", async () => {
    const p = await provider("Vermilion Book");
    const chat = nextChat--;
    h.channel.admins = [{ id: p.tg, status: "administrator" }];
    await h.myChatMember(chat, p.tg, "left", "administrator");
    h.channel.members = 4321;
    await recheckChannels(h.deps, h.bot.api, BOT_INFO.id);
    expect(await row(p.providerId)).toMatchObject({ channelId: chat, channelMembers: 4321, channelRole: "administrator" });
  });
});

describe("Telegram account linking", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  async function walletUser() {
    const a = privateKeyToAccount(generatePrivateKey());
    const p = await makeProvider({ address: a.address });
    return p;
  }

  it("/start acct_<token> from the app links this Telegram account to the wallet", async () => {
    const tg = nextTg++;
    await h.dm(tg, "/start"); // a Telegram-only user exists first
    const p = await walletUser();
    const { token } = await startLinkFromWeb(p.userId);
    await h.dm(tg, `/start acct_${token}`);

    const u = await db().query.users.findFirst({ where: eq(users.telegramId, tg) });
    expect(u!.id).toBe(p.userId);
    expect(h.sent(tg).at(-1)!.payload.text).toMatch(/Telegram linked<\/b> to wallet <code>0x/);

    // now /link_channel knows the provider
    await h.dm(tg, "/link_channel");
    expect(h.sent(tg).at(-1)!.payload.text).toMatch(/Verify your channel/);

    // the token is single-use
    await h.dm(tg, `/start acct_${token}`);
    expect(h.sent(tg).at(-1)!.payload.text).toMatch(/expired or was already used/);
  });

  it("/connect gives a one-time web link that a signed-in wallet redeems", async () => {
    const tg = nextTg++;
    await h.dm(tg, "/connect");
    const text = h.sent(tg).at(-1)!.payload.text as string;
    const token = text.match(/\/connect\?t=([0-9a-f]+)/)![1]!;
    const p = await walletUser();
    await redeemOnWeb(token, p.userId);
    expect((await db().query.users.findFirst({ where: eq(users.id, p.userId) }))!.telegramId).toBe(tg);

    await h.dm(tg, "/connect");
    expect(h.sent(tg).at(-1)!.payload.text).toMatch(/Telegram is linked to wallet/);
  });

  it("a Telegram account already on another wallet isn't moved", async () => {
    const first = await walletUser();
    const tg = nextTg++;
    await db().update(users).set({ telegramId: tg }).where(eq(users.id, first.userId));
    const second = await walletUser();
    const { token } = await startLinkFromWeb(second.userId);
    await h.dm(tg, `/start acct_${token}`);
    expect(h.sent(tg).at(-1)!.payload.text).toMatch(/already linked to another wallet/);
    expect((await db().query.users.findFirst({ where: eq(users.telegramId, tg) }))!.id).toBe(first.userId);
  });
});
