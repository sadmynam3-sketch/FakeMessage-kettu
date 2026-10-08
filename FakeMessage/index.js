vendetta => {
    const { findByProps, findByStoreName } = vendetta.metro.common;
    const { after } = vendetta.patcher;
    const storage = vendetta.plugin.storage;

    const fakeMessages = storage.fakeMessages || {};
    storage.fakeMessages = fakeMessages;

    let unpatches = [];

    function makeId() {
        return "fake-" + Date.now() + "-" +
            Math.random().toString(36).slice(2, 9);
    }

    function getMessageStore() {
        try {
            return findByStoreName("MessageStore");
        } catch (_) {}

        try {
            return findByProps("getMessage", "getMessages");
        } catch (_) {}

        return null;
    }

    function addFakeMessage(message) {
        if (!message || !message.channel_id) return;

        if (!fakeMessages[message.channel_id]) {
            fakeMessages[message.channel_id] = [];
        }

        fakeMessages[message.channel_id].push(message);
        storage.fakeMessages = fakeMessages;
    }

    function getFakeMessage(channelId, messageId) {
        const list = fakeMessages[channelId] || [];

        for (const message of list) {
            if (message.id === messageId) return message;
        }

        return null;
    }

    function getFakeMessages(channelId) {
        return fakeMessages[channelId] || [];
    }

    function patchStore() {
        const store = getMessageStore();

        if (!store) {
            console.log("[FakeMessage] MessageStore not found");
            return;
        }

        if (typeof store.getMessage === "function") {
            unpatches.push(
                after(store, "getMessage", (_, args, result) => {
                    if (result) return result;

                    const channelId = args[0];
                    const messageId = args[1];

                    return getFakeMessage(channelId, messageId) || result;
                })
            );
        }

        if (typeof store.getMessages === "function") {
            unpatches.push(
                after(store, "getMessages", (_, args, result) => {
                    const channelId = args[0];

                    if (!result) return result;

                    const fakes = getFakeMessages(channelId);

                    if (!fakes.length) return result;

                    try {
                        if (Array.isArray(result)) {
                            return result.concat(fakes);
                        }

                        if (result._array && Array.isArray(result._array)) {
                            result._array = result._array.concat(fakes);
                            return result;
                        }

                        if (result.messages && Array.isArray(result.messages)) {
                            result.messages = result.messages.concat(fakes);
                            return result;
                        }
                    } catch (_) {}

                    return result;
                })
            );
        }

        console.log("[FakeMessage] MessageStore patched");
    }

    function createFakeMessage(channelId, author, content) {
        const now = new Date().toISOString();

        const message = {
            id: makeId(),
            channel_id: String(channelId),
            guild_id: null,
            author: {
                id: String(author?.id || "0"),
                username: author?.username || "Fake User",
                discriminator: author?.discriminator || "0000",
                avatar: author?.avatar || null,
                global_name: author?.global_name || author?.username || "Fake User"
            },
            content: String(content || ""),
            timestamp: now,
            edited_timestamp: null,
            tts: false,
            mention_everyone: false,
            mentions: [],
            mention_roles: [],
            attachments: [],
            embeds: [],
            pinned: false,
            type: 0,
            flags: 0
        };

        addFakeMessage(message);

        return message;
    }

    function clearFakeMessages() {
        for (const key of Object.keys(fakeMessages)) {
            delete fakeMessages[key];
        }

        storage.fakeMessages = {};
    }

    return {
        onLoad() {
            patchStore();

            console.log("[FakeMessage] Loaded");
        },

        onUnload() {
            for (const unpatch of unpatches) {
                try {
                    unpatch();
                } catch (_) {}
            }

            unpatches = [];

            console.log("[FakeMessage] Unloaded");
        },

        createFakeMessage,
        addFakeMessage,
        getFakeMessage,
        getFakeMessages,
        clearFakeMessages
    };
}
