(() => {
    "use strict";

    const pluginName = "FakeMessage";
    const bunny = typeof globalThis.bunny !== "undefined" ? globalThis.bunny : null;
    const vendetta = typeof globalThis.vendetta !== "undefined" ? globalThis.vendetta : null;

    const logger =
        bunny?.plugin?.logger ??
        vendetta?.logger ??
        console;

    const storage =
        vendetta?.plugin?.storage ??
        bunny?.plugin?.storage ??
        {};

    const metro =
        bunny?.metro ??
        vendetta?.metro ??
        null;

    let fakeMessages = [];
    let unpatchMessages = null;
    let messageStore = null;

    function log(...args) {
        try { (logger.log ?? logger.info ?? console.log).call(logger, `[${pluginName}]`, ...args); }
        catch {}
    }

    function load() {
        try {
            const raw = storage.fakes;
            const value = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (Array.isArray(value)) fakeMessages = value;
        } catch {
            fakeMessages = [];
        }
    }

    function save() {
        try { storage.fakes = JSON.stringify(fakeMessages); } catch {}
    }

    function findStore() {
        return metro?.findByStoreName?.("MessageStore") ??
            metro?.findByProps?.("getMessages", "getMessage") ??
            null;
    }

    function currentUser() {
        try {
            const store =
                metro?.findByStoreName?.("UserStore") ??
                metro?.common?.stores?.UserStore;
            return store?.getCurrentUser?.() ?? null;
        } catch { return null; }
    }

    function getUser(id) {
        try {
            const store =
                metro?.findByStoreName?.("UserStore") ??
                metro?.common?.stores?.UserStore;
            return store?.getUser?.(id) ?? null;
        } catch { return null; }
    }

    function makeMessage(fake, base) {
        const author = getUser(fake.authorId) ?? fake.author;
        if (!author) return null;

        const msg = base ? Object.create(Object.getPrototypeOf(base)) : {};
        if (base) Object.assign(msg, base);

        Object.assign(msg, {
            id: fake.id,
            channel_id: fake.channelId,
            author,
            content: String(fake.content ?? ""),
            timestamp: new Date(Number(fake.timestamp) || Date.now()),
            editedTimestamp: null,
            nonce: fake.id,
            state: "SENT",
            type: 0,
            flags: 0,
            pinned: false,
            tts: false,
            attachments: [],
            embeds: [],
            reactions: [],
            components: [],
            stickers: [],
            mentions: [],
            mentionRoles: [],
            mentionChannels: [],
            _isFake: true
        });

        if (typeof msg.getChannelId !== "function")
            msg.getChannelId = () => fake.channelId;
        if (typeof msg.hasFlag !== "function")
            msg.hasFlag = () => false;
        if (typeof msg.isEdited !== "function")
            msg.isEdited = () => false;

        return msg;
    }

    function wrap(collection, channelId) {
        const items = fakeMessages.filter(x => String(x.channelId) === String(channelId));
        if (!items.length || !collection) return collection;

        const base = (() => {
            try {
                if (Array.isArray(collection._array)) return collection._array.slice();
                if (typeof collection.toArray === "function") return collection.toArray();
            } catch {}
            return [];
        })();

        const fake = items.map(x => makeMessage(x, base.find(m => m && !m._isFake))).filter(Boolean);
        const combined = () =>
            [...base.filter(x => !x?._isFake), ...fake]
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        return new Proxy(collection, {
            get(target, prop, receiver) {
                if (prop === "_array" || prop === "toArray") return combined;
                if (prop === Symbol.iterator) return () => combined()[Symbol.iterator]();
                if (prop === "size" || prop === "length") return combined().length;
                if (prop === "get") return id => {
                    const f = items.find(x => String(x.id) === String(id));
                    return f ? makeMessage(f, base[0]) : target.get?.(id);
                };
                return Reflect.get(target, prop, receiver);
            }
        });
    }

    function install() {
        messageStore = findStore();
        const patcher = bunny?.api?.patcher ?? vendetta?.patcher;

        if (!messageStore || !patcher?.instead) {
            log("MessageStore/patcher API not available; plugin loaded but cannot inject messages.");
            return;
        }

        if (messageStore.getMessages) {
            unpatchMessages = patcher.instead(
                "getMessages",
                messageStore,
                (args, original) => wrap(original(...args), args?.[0])
            );
        }

        log("Loaded.");
    }

    function uninstall() {
        try { unpatchMessages?.(); } catch {}
        unpatchMessages = null;
        messageStore = null;
    }

    function addFake(channelId, authorId, content) {
        if (!channelId || !authorId || !content) return false;

        fakeMessages.push({
            id: `fakemessage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            channelId: String(channelId),
            authorId: String(authorId),
            content: String(content),
            timestamp: Date.now()
        });

        if (fakeMessages.length > 200) fakeMessages = fakeMessages.slice(-200);
        save();
        try { messageStore?.emitChange?.(); } catch {}
        return true;
    }

    // Expose a tiny API for testing from Kettu's JS console.
    globalThis.FakeMessage = {
        add: addFake,
        clear() {
            fakeMessages = [];
            save();
            try { messageStore?.emitChange?.(); } catch {}
        },
        list() { return fakeMessages.slice(); }
    };

    load();

    // External-plugin loaders commonly execute the file directly.
    // Returning an object here lets compatible loaders register lifecycle methods.
    return {
        name: pluginName,
        start: install,
        stop: uninstall,
        onLoad: install,
        onUnload: uninstall
    };
})()
