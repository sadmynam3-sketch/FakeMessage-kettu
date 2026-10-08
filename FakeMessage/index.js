(function (vendetta) {
    "use strict";

    const pluginName = "FakeMessage";

    const logger = vendetta?.logger ?? console;
    const metro = vendetta?.metro;
    const patcher = vendetta?.patcher;
    const storage = vendetta?.storage;

    let fakeMessages = [];
    let unpatch = null;
    let messageStore = null;

    function log(...args) {
        try {
            (logger.log ?? console.log).call(logger, `[${pluginName}]`, ...args);
        } catch {}
    }

    function load() {
        try {
            const raw = storage?.load?.("FakeMessage", "fakes");

            if (Array.isArray(raw)) {
                fakeMessages = raw;
                return;
            }

            if (typeof raw === "string") {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) fakeMessages = parsed;
            }
        } catch {
            fakeMessages = [];
        }
    }

    function save() {
        try {
            storage?.save?.("FakeMessage", "fakes", fakeMessages);
        } catch {}
    }

    function findMessageStore() {
        try {
            return (
                metro?.findByStoreName?.("MessageStore") ??
                metro?.findByProps?.("getMessages", "getMessage") ??
                null
            );
        } catch {
            return null;
        }
    }

    function getUser(id) {
        try {
            const users =
                metro?.findByStoreName?.("UserStore") ??
                metro?.findByProps?.("getUser", "getCurrentUser");

            return users?.getUser?.(String(id)) ?? null;
        } catch {
            return null;
        }
    }

    function createMessage(fake, original) {
        const author = getUser(fake.authorId);

        if (!author) return null;

        const message = original
            ? Object.create(Object.getPrototypeOf(original))
            : {};

        if (original) Object.assign(message, original);

        Object.assign(message, {
            id: String(fake.id),
            channel_id: String(fake.channelId),
            author,
            content: String(fake.content ?? ""),
            timestamp: new Date(Number(fake.timestamp) || Date.now()),
            editedTimestamp: null,
            nonce: String(fake.id),
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

        return message;
    }

    function getArray(collection) {
        try {
            if (typeof collection?.toArray === "function") {
                return collection.toArray();
            }

            if (Array.isArray(collection?._array)) {
                return collection._array.slice();
            }
        } catch {}

        return [];
    }

    function inject(collection, channelId) {
        if (!collection) return collection;

        const matching = fakeMessages.filter(
            x => String(x.channelId) === String(channelId)
        );

        if (!matching.length) return collection;

        const original = getArray(collection);

        const fakes = matching
            .map(fake => createMessage(fake, original[0]))
            .filter(Boolean);

        const combined = [...original, ...fakes].sort(
            (a, b) =>
                new Date(a.timestamp).getTime() -
                new Date(b.timestamp).getTime()
        );

        try {
            if (Array.isArray(collection._array)) {
                collection._array = combined;
            }

            if (typeof collection.toArray === "function") {
                collection.toArray = () => combined;
            }
        } catch {}

        return collection;
    }

    function addFake(channelId, authorId, content) {
        if (!channelId || !authorId || !content) {
            return false;
        }

        fakeMessages.push({
            id:
                `fake-${Date.now()}-` +
                Math.random().toString(36).slice(2, 8),
            channelId: String(channelId),
            authorId: String(authorId),
            content: String(content),
            timestamp: Date.now()
        });

        if (fakeMessages.length > 200) {
            fakeMessages = fakeMessages.slice(-200);
        }

        save();
        return true;
    }

    function clearFakeMessages() {
        fakeMessages = [];
        save();
    }

    function start() {
        load();

        messageStore = findMessageStore();

        if (!messageStore) {
            log("MessageStore was not found.");
            return;
        }

        if (!patcher?.after) {
            log("Vendetta patcher was not found.");
            return;
        }

        try {
            unpatch = patcher.after(
                pluginName,
                messageStore,
                "getMessages",
                (args, result) => inject(result, args?.[0])
            );

            log("Loaded.");
        } catch (error) {
            log("Failed to patch MessageStore:", error);
        }
    }

    function stop() {
        try {
            unpatch?.();
        } catch {}

        unpatch = null;
        messageStore = null;
    }

    return {
        name: pluginName,
        description:
            "Creates client-side fake messages visible only on this device.",
        onLoad: start,
        onUnload: stop,

        // Also expose these for testing.
        addFake,
        clearFakeMessages,
        getFakeMessages: () => fakeMessages.slice()
    };
})(vendetta)
