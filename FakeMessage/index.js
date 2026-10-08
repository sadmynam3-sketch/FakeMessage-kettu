(function () {
    "use strict";

    var patches = [];
    var fakes = [];
    var storage = null;
    var messageStore = null;

    function toast(text) {
        try {
            var t = vendetta.ui?.toasts?.showToast;
            if (t) return t(String(text));
        } catch (_) {}
        try { console.log("[FakeMessage] " + text); } catch (_) {}
    }

    function findStore() {
        try {
            var c = vendetta.metro.common;
            if (c.findByStoreName) {
                var s = c.findByStoreName("MessageStore");
                if (s) return s;
            }
        } catch (_) {}

        try {
            return vendetta.metro.common.findByProps(
                "getMessages",
                "getMessage"
            );
        } catch (_) {}

        return null;
    }

    function save() {
        try {
            if (storage) storage.fakeMessages = fakes;
        } catch (_) {}
    }

    function load() {
        try {
            storage = vendetta.storage;
            if (Array.isArray(storage?.fakeMessages))
                fakes = storage.fakeMessages;
        } catch (_) {}

        if (!Array.isArray(fakes)) fakes = [];
    }

    function refresh() {
        try {
            if (messageStore?.emitChange)
                messageStore.emitChange();
        } catch (_) {}
    }

    function fakeMessage(f, base) {
        var m = base ? Object.assign({}, base) : {};

        m.id = f.id;
        m.channel_id = f.channelId;
        m.content = f.content;
        m.author = f.author;
        m.timestamp = new Date(f.timestamp);
        m.editedTimestamp = null;
        m.nonce = f.id;
        m.state = "SENT";
        m.type = 0;
        m.flags = 0;
        m.pinned = false;
        m.tts = false;
        m.mentionEveryone = false;
        m.mentions = [];
        m.mentionRoles = [];
        m.mentionChannels = [];
        m.attachments = [];
        m.embeds = [];
        m.reactions = [];
        m.components = [];
        m.stickers = [];
        m.stickerItems = [];
        m._isFake = true;

        return m;
    }

    function channelFakes(channelId) {
        return fakes.filter(
            function (f) {
                return String(f.channelId) === String(channelId);
            }
        );
    }

    function patch() {
        messageStore = findStore();

        if (!messageStore) {
            toast("FakeMessage: MessageStore not found");
            return;
        }

        if (typeof messageStore.getMessages === "function") {
            var oldGetMessages = messageStore.getMessages;

            messageStore.getMessages = function () {
                var args = arguments;
                var result = oldGetMessages.apply(this, args);
                var extra = channelFakes(args[0]);

                if (!extra.length || !result)
                    return result;

                try {
                    if (Array.isArray(result)) {
                        return result.concat(
                            extra.map(function (f) {
                                return fakeMessage(f);
                            })
                        );
                    }

                    if (Array.isArray(result._array)) {
                        var copy = Object.assign({}, result);
                        copy._array = result._array.concat(
                            extra.map(function (f) {
                                return fakeMessage(f, result._array[0]);
                            })
                        );
                        copy.toArray = function () {
                            return copy._array.slice();
                        };
                        return copy;
                    }
                } catch (_) {}

                return result;
            };

            patches.push(function () {
                messageStore.getMessages = oldGetMessages;
            });
        }

        if (typeof messageStore.getMessage === "function") {
            var oldGetMessage = messageStore.getMessage;

            messageStore.getMessage = function () {
                var channelId = arguments[0];
                var messageId = arguments[1];

                var f = fakes.find(function (x) {
                    return String(x.channelId) === String(channelId) &&
                           String(x.id) === String(messageId);
                });

                if (f) return fakeMessage(f);

                return oldGetMessage.apply(this, arguments);
            };

            patches.push(function () {
                messageStore.getMessage = oldGetMessage;
            });
        }
    }

    function add(channelId, author, content) {
        var f = {
            id:
                "fakemessage-" +
                Date.now() +
                "-" +
                Math.random().toString(36).slice(2),

            channelId: String(channelId),

            author: author || {
                id: "0",
                username: "Fake User",
                globalName: "Fake User"
            },

            content: String(content || ""),
            timestamp: Date.now()
        };

        fakes.push(f);
        save();
        refresh();

        return f;
    }

    function clear() {
        fakes = [];
        save();
        refresh();
    }

    return {
        onLoad: function () {
            load();
            patch();

            try {
                globalThis.FakeMessage = {
                    add: add,
                    clear: clear,
                    list: function () {
                        return fakes.slice();
                    }
                };
            } catch (_) {}

            toast("FakeMessage loaded");
        },

        onUnload: function () {
            patches.splice(0).forEach(function (fn) {
                try { fn(); } catch (_) {}
            });

            try {
                delete globalThis.FakeMessage;
            } catch (_) {}
        }
    };
})()
