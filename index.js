/* FakeMessage - Kettu/Vendetta-family client-only plugin
 * Self-contained runtime JS. No Vencord imports.
 */
(() => {
  "use strict";

  const V = globalThis.vendetta || globalThis.bunny || globalThis.kettu;
  const metro = V?.metro;
  const patcher = V?.patcher;
  const storage = V?.storage;
  const ui = V?.ui;

  let MessageStore;
  let UserStore;
  let oldGetMessages = null;
  let oldGetMessage = null;
  let fakes = [];
  const KEY = "FakeMessage.fakes";
  const PREFIX = "fake-";
  const MAX = 50;

  function log(...x) { console.log("[FakeMessage]", ...x); }
  function toast(s) {
    try { ui?.toasts?.showToast?.(String(s)); return; } catch {}
    try { ui?.showToast?.(String(s)); return; } catch {}
    log(s);
  }

  async function load() {
    try {
      if (storage?.get) {
        const v = await storage.get(KEY);
        fakes = Array.isArray(v) ? v : [];
      } else if (storage?.getData) {
        const v = await storage.getData(KEY);
        fakes = Array.isArray(v) ? v : [];
      }
    } catch (e) { log("storage load failed", e); }
  }

  async function save() {
    try {
      if (storage?.set) await storage.set(KEY, fakes);
      else if (storage?.setData) await storage.setData(KEY, fakes);
    } catch (e) { log("storage save failed", e); }
  }

  function getStore(name, props) {
    try {
      if (metro?.findByStoreName) {
        const s = metro.findByStoreName(name);
        if (s) return s;
      }
      if (metro?.findByProps && props) return metro.findByProps(...props);
    } catch (e) { log("metro lookup failed", e); }
  }

  function getFakes(channelId) { return fakes.filter(x => x.channelId === channelId); }

  function currentUser() {
    try { return UserStore?.getCurrentUser?.() || null; } catch { return null; }
  }

  function getUser(id, snapshot) {
    try {
      const u = UserStore?.getUser?.(id);
      if (u) return u;
    } catch {}
    return snapshot || null;
  }

  function makeMessage(fake, base) {
    const author = getUser(fake.authorId, fake.author);
    if (!author) return null;
    const m = base && typeof base === "object" ? { ...base } : {};
    Object.assign(m, {
      id: fake.id,
      channel_id: fake.channelId,
      author,
      content: fake.content || "",
      timestamp: new Date(fake.timestamp),
      editedTimestamp: null,
      nonce: fake.id,
      state: "SENT",
      type: fake.call ? 3 : 0,
      flags: 0,
      pinned: false,
      tts: false,
      mentions: [],
      mentionRoles: [],
      mentionChannels: [],
      attachments: [],
      embeds: [],
      reactions: [],
      components: [],
      stickers: [],
      stickerItems: [],
      referencedMessage: undefined,
      messageReference: undefined,
      _isFake: true,
      deleted: undefined
    });
    if (fake.call) {
      const participants = [fake.authorId];
      const me = currentUser();
      if (me?.id) participants.push(me.id);
      m.call = {
        participants,
        duration: fake.call.durationSeconds || 0,
        missed: !!fake.call.missed
      };
      m.callParticipants = participants;
    }
    return m;
  }

  function wrapCollection(collection, channelId) {
    const fs = getFakes(channelId);
    if (!collection || !fs.length) return collection;
    const real = () => Array.isArray(collection._array) ? collection._array : [];
    const combined = () => [...real(), ...fs.map(x => makeMessage(x, real()[0])).filter(Boolean)]
      .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    return new Proxy(collection, {
      get(target, prop, receiver) {
        if (prop === "_array" || prop === "toArray") return prop === "_array" ? combined() : combined;
        if (prop === "size" || prop === "length") return combined().length;
        if (prop === "get") return id => {
          const f = fs.find(x => x.id === id);
          return f ? makeMessage(f, real()[0]) : target.get?.(id);
        };
        if (prop === "has") return id => !!fs.find(x => x.id === id) || !!target.has?.(id);
        if (prop === Symbol.iterator) return combined()[Symbol.iterator].bind(combined());
        if (["map","filter","find","findIndex","some","every","forEach","includes","indexOf","keys","values","entries"].includes(prop))
          return (...args) => combined()[prop](...args);
        return Reflect.get(target, prop, receiver);
      }
    });
  }

  function refresh() {
    try { MessageStore?.emitChange?.(); } catch {}
    try { V?.metro?.common?.FluxDispatcher?.dispatch?.({ type: "MESSAGE_CREATE", message: null }); } catch {}
  }

  function patchStore() {
    if (!MessageStore || oldGetMessages) return;
    if (typeof MessageStore.getMessages === "function") {
      oldGetMessages = MessageStore.getMessages.bind(MessageStore);
      MessageStore.getMessages = channelId => wrapCollection(oldGetMessages(channelId), channelId);
    }
    if (typeof MessageStore.getMessage === "function") {
      oldGetMessage = MessageStore.getMessage.bind(MessageStore);
      MessageStore.getMessage = (channelId, messageId) => {
        const fake = fakes.find(x => x.channelId === channelId && x.id === messageId);
        if (fake) return makeMessage(fake, null);
        return oldGetMessage(channelId, messageId);
      };
    }
  }

  function unpatchStore() {
    if (MessageStore && oldGetMessages) MessageStore.getMessages = oldGetMessages;
    if (MessageStore && oldGetMessage) MessageStore.getMessage = oldGetMessage;
    oldGetMessages = oldGetMessage = null;
  }

  function snapshotUser(user) {
    if (!user) return null;
    const keys = ["id","username","globalName","discriminator","avatar","bot","publicFlags","accentColor"];
    const out = {};
    for (const k of keys) if (user[k] !== undefined) out[k] = user[k];
    return out;
  }

  async function inject(channelId, user, content, minutesAgo = 0) {
    if (!channelId || !user || !String(content || "").trim()) return false;
    if (getFakes(channelId).length >= MAX) { toast(`Maximum ${MAX} fake messages in this channel`); return false; }
    fakes.push({
      id: PREFIX + Date.now() + "-" + Math.random().toString(36).slice(2,8),
      channelId, authorId: user.id, author: snapshotUser(user),
      content: String(content).trim(), timestamp: Date.now() - Math.max(0, Number(minutesAgo)||0)*60000
    });
    await save(); refresh(); toast("Fake message added"); return true;
  }

  async function injectCall(channelId, user, durationSeconds = 300, minutesAgo = 0, missed = false) {
    if (!channelId || !user) return false;
    if (getFakes(channelId).length >= MAX) { toast(`Maximum ${MAX} fake messages in this channel`); return false; }
    fakes.push({
      id: PREFIX + Date.now() + "-" + Math.random().toString(36).slice(2,8),
      channelId, authorId: user.id, author: snapshotUser(user), content: "",
      timestamp: Date.now() - Math.max(0, Number(minutesAgo)||0)*60000,
      call: { durationSeconds: Math.max(0, Number(durationSeconds)||0), missed: !!missed }
    });
    await save(); refresh(); toast("Fake call added"); return true;
  }

  async function removeFake(id) { fakes = fakes.filter(x => x.id !== id); await save(); refresh(); }
  async function clearChannel(channelId) { fakes = fakes.filter(x => x.channelId !== channelId); await save(); refresh(); }
  async function clearAll() { fakes = []; await save(); refresh(); }

  const plugin = {
    name: "FakeMessage",
    description: "Client-only fake messages and call logs",
    authors: [{ name: "Elioflex", id: "0" }],
    onLoad: async () => {
      await load();
      MessageStore = getStore("MessageStore", ["getMessages","getMessage"]);
      UserStore = getStore("UserStore", ["getUser","getCurrentUser"]);
      patchStore();
      globalThis.FakeMessage = { inject, injectCall, removeFake, clearChannel, clearAll, list: () => [...fakes] };
      log("loaded", fakes.length, "fake(s)");
    },
    onUnload: () => {
      unpatchStore();
      try { delete globalThis.FakeMessage; } catch {}
      log("unloaded");
    }
  };

  return plugin;
})()
