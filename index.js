/*
 * FakeMessage — Kettu/Vendetta-style port
 * Local/client-side only: fake entries are injected into the mobile message
 * store in this Discord client and are never sent to Discord.
 */

(() => {
    "use strict";

    const NAME = "FakeMessage";
    const ID_PREFIX = "fakemessage-";
    const MAX_FAKES_PER_CHANNEL = 50;

    const V = typeof vendetta !== "undefined" ? vendetta : null;
    const B = typeof bunny !== "undefined" ? bunny : null;

    const React = B?.metro?.common?.React ?? V?.metro?.common?.React;
    const RN = B?.metro?.common?.ReactNative ?? V?.metro?.common?.ReactNative;

    const logger = V?.logger ?? B?.plugin?.logger ?? {
        log: (...a) => console.log(`[${NAME}]`, ...a),
        info: (...a) => console.log(`[${NAME}]`, ...a),
        warn: (...a) => console.warn(`[${NAME}]`, ...a),
        error: (...a) => console.error(`[${NAME}]`, ...a),
    };

    const patcher = B?.api?.patcher ?? V?.patcher;
    const metro = B?.metro ?? V?.metro;
    const ui = B?.ui ?? V?.ui;
    const storage = V?.plugin?.storage ?? B?.plugin?.createStorage?.() ?? {};

    let fakes = [];
    let unpatchGetMessages = null;
    let unpatchGetMessage = null;
    let unregisterSettings = null;
    let messageStore = null;
    let mounted = false;

    const settings = {
        persist: storage.persist !== false,
        allowCalls: storage.allowCalls !== false,
    };

    function save() {
        try {
            storage.persist = settings.persist;
            storage.allowCalls = settings.allowCalls;
            storage.fakes = JSON.stringify(settings.persist ? fakes : []);
        } catch (e) {
            logger.warn("Failed to save fake messages", e);
        }
    }

    function load() {
        fakes = [];
        if (!settings.persist) return;
        try {
            const parsed = JSON.parse(typeof storage.fakes === "string" ? storage.fakes : "[]");
            if (Array.isArray(parsed)) {
                fakes = parsed.filter(x => x && typeof x === "object" && typeof x.id === "string");
            }
        } catch (e) {
            logger.warn("Failed to load fake messages", e);
        }
    }

    function getUserStore() {
        return (
            metro?.findByStoreName?.("UserStore") ??
            B?.metro?.common?.stores?.UserStore ??
            V?.metro?.common?.stores?.UserStore ??
            null
        );
    }

    function getCurrentUser() {
        try {
            return getUserStore()?.getCurrentUser?.() ?? null;
        } catch {
            return null;
        }
    }

    function getUser(id) {
        if (!id) return null;
        try {
            return getUserStore()?.getUser?.(id) ?? null;
        } catch {
            return null;
        }
    }

    function snapshotUser(user) {
        if (!user?.id) return undefined;
        return {
            id: String(user.id),
            username: user.username ?? String(user.id),
            globalName: user.globalName ?? null,
            discriminator: user.discriminator ?? null,
            avatar: user.avatar ?? null,
            bot: Boolean(user.bot),
            system: Boolean(user.system),
        };
    }

    function resolveUser(fake) {
        const cached = getUser(fake.authorId);
        if (cached) return cached;

        if (!fake.author) return null;
        const json = fake.author;
        return {
            ...json,
            id: String(json.id),
            username: json.username ?? String(json.id),
            globalName: json.globalName ?? null,
            getAvatarURL: () => undefined,
            getBannerURL: () => undefined,
            getAvatarDecorationURL: () => undefined,
            getAccentColor: () => json.accentColor ?? null,
        };
    }

    function extractMentionIds(regex, content) {
        const out = [];
        let match;
        regex.lastIndex = 0;
        while ((match = regex.exec(content))) out.push(match[1]);
        regex.lastIndex = 0;
        return out;
    }

    const MENTION_RE = /<@!?(\d{15,21})>/g;
    const ROLE_MENTION_RE = /<@&(\d{15,21})>/g;
    const CHANNEL_MENTION_RE = /<#(\d{15,21})>/g;

    function findBase(collection) {
        try {
            if (Array.isArray(collection?._array)) {
                return collection._array.find(m => m && !m._isFake) ?? null;
            }
            if (typeof collection?.toArray === "function") {
                return collection.toArray().find(m => m && !m._isFake) ?? null;
            }
        } catch {
            // Ignore and fall back to a standalone message shape.
        }
        return null;
    }

    function buildFakeMessage(fake, base) {
        const author = resolveUser(fake);
        if (!author) return null;

        const timestamp = new Date(Number(fake.timestamp) || Date.now());
        const mentions = extractMentionIds(MENTION_RE, fake.content ?? "");
        const roleMentions = extractMentionIds(ROLE_MENTION_RE, fake.content ?? "");
        const channelMentions = extractMentionIds(CHANNEL_MENTION_RE, fake.content ?? "");

        const msg = base
            ? Object.create(Object.getPrototypeOf(base))
            : {};

        if (base) Object.assign(msg, base);

        const currentUserId = getCurrentUser()?.id;
        const missed = Boolean(fake.call?.missed);
        const isCall = Boolean(fake.call);

        Object.assign(msg, {
            id: fake.id,
            channel_id: fake.channelId,
            author,
            bot: Boolean(author.bot),
            content: isCall ? "" : String(fake.content ?? ""),
            timestamp,
            editedTimestamp: null,
            nonce: fake.id,
            state: "SENT",
            type: isCall ? 3 : 0,
            flags: 0,
            pinned: false,
            tts: false,
            mentionEveryone: false,
            mentioned: false,
            mentions,
            mentionRoles: roleMentions,
            mentionChannels: channelMentions,
            blocked: false,
            ignored: false,
            nick: null,
            colorString: null,
            member: undefined,
            referencedMessage: undefined,
            messageReference: undefined,
            webhookId: undefined,
            _isFake: true,
            deleted: undefined,
            attachments: [],
            embeds: [],
            reactions: [],
            components: [],
            stickers: [],
            stickerItems: [],
            soundboardSounds: [],
            codedLinks: [],
            giftCodes: [],
            mentionGames: [],
            messageSnapshots: [],
            poll: null,
            potions: null,
            activity: null,
            interaction: null,
            interactionMetadata: null,
            application: null,
            applicationId: null,
            purchaseNotification: null,
            giftingPrompt: null,
            premiumGroupInviteId: null,
            customRenderedContent: null,
        });

        if (isCall) {
            const seconds = Math.max(0, Number(fake.call.durationSeconds) || 0);
            const duration = seconds > 0 ? makeMomentDuration(seconds) : null;
            msg.call = {
                duration,
                endedTimestamp: timestamp,
                participants: missed
                    ? [String(fake.authorId)]
                    : [String(fake.authorId), currentUserId].filter(Boolean),
            };
        } else {
            msg.call = null;
        }

        if (typeof msg.getChannelId !== "function") {
            msg.getChannelId = () => fake.channelId;
        }
        if (typeof msg.hasFlag !== "function") {
            msg.hasFlag = () => false;
        }
        if (typeof msg.isEdited !== "function") {
            msg.isEdited = () => false;
        }
        if (typeof msg.isCommandType !== "function") {
            msg.isCommandType = () => false;
        }

        return msg;
    }

    function makeMomentDuration(seconds) {
        try {
            const moment = metro?.common?.moment;
            if (moment?.duration) return moment.duration(seconds, "seconds");
        } catch {
            // Fall through to a small duration shim.
        }
        return {
            asSeconds: () => seconds,
            asMinutes: () => seconds / 60,
            humanize: () => formatDuration(seconds),
            seconds,
        };
    }

    function formatDuration(seconds) {
        const s = Math.max(0, Number(seconds) || 0);
        if (s < 60) return `${Math.floor(s)} seconds`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
        const h = Math.floor(m / 60);
        const rem = m % 60;
        return rem ? `${h}h ${rem}m` : `${h} hour${h === 1 ? "" : "s"}`;
    }

    function fakesForChannel(channelId) {
        if (!channelId) return [];
        return fakes.filter(f => f.channelId === String(channelId));
    }

    function wrapCollection(collection, channelId) {
        const channelFakes = fakesForChannel(channelId);
        if (!collection || channelFakes.length === 0) return collection;

        const combined = () => {
            const base = (() => {
                try {
                    if (Array.isArray(collection._array)) return collection._array.slice();
                    if (typeof collection.toArray === "function") return collection.toArray();
                } catch {
                    return [];
                }
                return [];
            })();

            const fakeMessages = channelFakes
                .map(fake => buildFakeMessage(fake, findBase(collection)))
                .filter(Boolean);

            return [...base.filter(m => !m?._isFake), ...fakeMessages]
                .sort((a, b) => (+new Date(a.timestamp)) - (+new Date(b.timestamp)));
        };

        return new Proxy(collection, {
            get(target, prop, receiver) {
                if (prop === Symbol.iterator) {
                    const arr = combined();
                    return arr[Symbol.iterator].bind(arr);
                }
                if (prop === "_array") return combined();
                if (prop === "toArray") return combined;
                if (prop === "size" || prop === "length") return combined().length;
                if (prop === "get") {
                    return id => {
                        const fake = fakes.find(x => x.id === String(id) && x.channelId === String(channelId));
                        if (fake) return buildFakeMessage(fake, findBase(collection));
                        return typeof target.get === "function" ? target.get(id) : undefined;
                    };
                }
                if (prop === "has") {
                    return id => {
                        const fake = fakes.some(x => x.id === String(id) && x.channelId === String(channelId));
                        return fake || (typeof target.has === "function" ? target.has(id) : false);
                    };
                }
                if ([
                    "first", "last", "at", "forEach", "some", "every", "filter", "map",
                    "find", "findIndex", "reduce", "indexOf", "includes", "keys", "values", "entries"
                ].includes(prop)) {
                    const arr = combined();
                    const fn = arr[prop];
                    if (typeof fn === "function") return fn.bind(arr);
                    return fn;
                }
                return Reflect.get(target, prop, receiver);
            },
        });
    }

    function findMessageStore() {
        return (
            metro?.findByStoreName?.("MessageStore") ??
            metro?.findByProps?.("getMessages", "getMessage") ??
            null
        );
    }

    function refresh() {
        try {
            messageStore?.emitChange?.();
        } catch (e) {
            logger.warn("MessageStore refresh failed", e);
        }
    }

    function installPatches() {
        messageStore = findMessageStore();
        if (!messageStore || !patcher?.instead) {
            logger.error("MessageStore or patcher API not found");
            return false;
        }

        if (messageStore.getMessages && !unpatchGetMessages) {
            unpatchGetMessages = patcher.instead("getMessages", messageStore, (args, orig) => {
                const channelId = args?.[0];
                const result = orig(...args);
                return wrapCollection(result, channelId);
            });
        }

        if (messageStore.getMessage && !unpatchGetMessage) {
            unpatchGetMessage = patcher.instead("getMessage", messageStore, (args, orig) => {
                const channelId = args?.[0];
                const messageId = args?.[1];
                const fake = fakes.find(x => x.channelId === String(channelId) && x.id === String(messageId));
                if (fake) return buildFakeMessage(fake, findBase(messageStore.getMessages?.(channelId)));
                return orig(...args);
            });
        }

        return true;
    }

    function uninstallPatches() {
        try { unpatchGetMessages?.(); } catch { /* noop */ }
        try { unpatchGetMessage?.(); } catch { /* noop */ }
        unpatchGetMessages = null;
        unpatchGetMessage = null;
        messageStore = null;
    }

    function notify(text) {
        try {
            const toast = ui?.toasts?.showToast;
            if (toast) {
                const icon = ui?.assets?.getAssetIDByName?.("Check");
                toast(text, icon);
                return;
            }
        } catch {
            // Ignore and fall back.
        }
        logger.info(text);
    }

    function removeFake(id) {
        const before = fakes.length;
        fakes = fakes.filter(f => f.id !== String(id));
        if (fakes.length !== before) {
            save();
            refresh();
        }
    }

    function clearAll() {
        fakes = [];
        save();
        refresh();
        notify("All fake messages removed");
    }

    function makeId() {
        return `${ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function parseDuration(value) {
        const v = String(value ?? "").trim();
        if (!v) return 0;
        if (/^\d+$/.test(v)) return Math.max(0, Number(v));
        const m = v.match(/^(\d{1,3}):([0-5]?\d)$/);
        if (!m) return 0;
        return Number(m[1]) * 60 + Number(m[2]);
    }

    function addFakeMessage({ channelId, authorId, content, minutesAgo }) {
        const user = getUser(authorId);
        if (!user) throw new Error("That user is not currently cached by Discord.");
        if (!channelId) throw new Error("A channel ID is required.");
        if (!String(content ?? "").trim()) throw new Error("Message content is required.");

        const existing = fakesForChannel(channelId);
        if (existing.length >= MAX_FAKES_PER_CHANNEL) {
            throw new Error(`Maximum of ${MAX_FAKES_PER_CHANNEL} fake entries per channel.`);
        }

        fakes.push({
            id: makeId(),
            channelId: String(channelId),
            authorId: String(authorId),
            author: snapshotUser(user),
            content: String(content),
            timestamp: Date.now() - Math.max(0, Number(minutesAgo) || 0) * 60_000,
        });
        save();
        refresh();
    }

    function addFakeCall({ channelId, authorId, durationSeconds, missed, minutesAgo }) {
        if (!settings.allowCalls) throw new Error("Fake calls are disabled in this plugin's settings.");
        const user = getUser(authorId);
        if (!user) throw new Error("That user is not currently cached by Discord.");
        if (!channelId) throw new Error("A channel ID is required.");

        const existing = fakesForChannel(channelId);
        if (existing.length >= MAX_FAKES_PER_CHANNEL) {
            throw new Error(`Maximum of ${MAX_FAKES_PER_CHANNEL} fake entries per channel.`);
        }

        fakes.push({
            id: makeId(),
            channelId: String(channelId),
            authorId: String(authorId),
            author: snapshotUser(user),
            content: "",
            timestamp: Date.now() - Math.max(0, Number(minutesAgo) || 0) * 60_000,
            call: {
                durationSeconds: Math.max(0, Number(durationSeconds) || 0),
                missed: Boolean(missed),
            },
        });
        save();
        refresh();
    }

    function getDefaultChannelId() {
        try {
            const selected =
                metro?.findByProps?.("getChannelId")?.getChannelId?.() ??
                metro?.findByProps?.("getChannelId", "getLastSelectedChannelId")?.getChannelId?.();
            if (selected) return String(selected);
        } catch {
            // fall back to empty input
        }
        return "";
    }

    function uiAlert(title, content) {
        try {
            const alert = ui?.alerts?.showConfirmationAlert;
            if (alert) {
                alert({ title, content, confirmText: "OK" });
                return;
            }
        } catch {
            // noop
        }
        notify(`${title}: ${content}`);
    }

    function Button({ title, onPress, danger = false }) {
        if (!RN) return null;
        return React.createElement(
            RN.Pressable,
            {
                onPress,
                style: ({ pressed }) => ({
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    marginTop: 8,
                    backgroundColor: danger ? "#da373c" : "#5865f2",
                    opacity: pressed ? 0.75 : 1,
                }),
            },
            React.createElement(RN.Text, { style: { color: "#fff", fontWeight: "600", textAlign: "center" } }, title)
        );
    }

    function Field({ label, value, onChangeText, placeholder, multiline = false, keyboardType }) {
        if (!RN) return null;
        return React.createElement(
            RN.View,
            { style: { marginTop: 10 } },
            React.createElement(RN.Text, { style: { color: "#b5bac1", marginBottom: 6, fontSize: 13 } }, label),
            React.createElement(RN.TextInput, {
                value,
                onChangeText,
                placeholder,
                placeholderTextColor: "#72767d",
                keyboardType,
                multiline,
                textAlignVertical: multiline ? "top" : "center",
                style: {
                    minHeight: multiline ? 90 : 42,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: "#3f4147",
                    paddingHorizontal: 10,
                    paddingVertical: 9,
                    color: "#f2f3f5",
                    backgroundColor: "#1e1f22",
                },
            })
        );
    }

    function SettingsScreen() {
        if (!React || !RN) return null;

        const [channelId, setChannelId] = React.useState(getDefaultChannelId());
        const [authorId, setAuthorId] = React.useState("");
        const [content, setContent] = React.useState("");
        const [minutesAgo, setMinutesAgo] = React.useState("0");
        const [duration, setDuration] = React.useState("5:00");
        const [missed, setMissed] = React.useState(false);
        const [status, setStatus] = React.useState("");
        const [, forceUpdate] = React.useState(0);

        const doAddMessage = () => {
            try {
                addFakeMessage({ channelId, authorId, content, minutesAgo });
                setStatus("Fake message added.");
                forceUpdate(x => x + 1);
            } catch (e) {
                setStatus(e?.message ?? String(e));
            }
        };

        const doAddCall = () => {
            try {
                addFakeCall({
                    channelId,
                    authorId,
                    durationSeconds: parseDuration(duration),
                    missed,
                    minutesAgo,
                });
                setStatus("Fake call log added.");
                forceUpdate(x => x + 1);
            } catch (e) {
                setStatus(e?.message ?? String(e));
            }
        };

        const rows = fakes.slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);

        return React.createElement(
            RN.ScrollView,
            { style: { flex: 1, backgroundColor: "#111214" }, contentContainerStyle: { padding: 16, paddingBottom: 32 } },
            React.createElement(RN.Text, { style: { color: "#f2f3f5", fontSize: 22, fontWeight: "700" } }, NAME),
            React.createElement(
                RN.Text,
                { style: { color: "#b5bac1", marginTop: 6, lineHeight: 20 } },
                "Client-side only. Entries are injected into this device's message store and are not sent to Discord."
            ),

            React.createElement(
                RN.View,
                { style: { marginTop: 16, paddingTop: 4 } },
                React.createElement(Field, {
                    label: "Channel ID",
                    value: channelId,
                    onChangeText: setChannelId,
                    placeholder: "123456789012345678",
                    keyboardType: "numeric",
                }),
                React.createElement(Field, {
                    label: "User ID",
                    value: authorId,
                    onChangeText: setAuthorId,
                    placeholder: "User must already be cached in Discord",
                    keyboardType: "numeric",
                }),
                React.createElement(Field, {
                    label: "Message",
                    value: content,
                    onChangeText: setContent,
                    placeholder: "Write the fake message…",
                    multiline: true,
                }),
                React.createElement(Field, {
                    label: "Minutes ago",
                    value: minutesAgo,
                    onChangeText: setMinutesAgo,
                    placeholder: "0",
                    keyboardType: "numeric",
                }),
                React.createElement(Button, { title: "Add fake message", onPress: doAddMessage }),

                React.createElement(
                    RN.View,
                    { style: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#2b2d31" } },
                    React.createElement(RN.Text, { style: { color: "#f2f3f5", fontSize: 17, fontWeight: "700" } }, "Fake call log"),
                    React.createElement(Field, {
                        label: "Duration (mm:ss or seconds)",
                        value: duration,
                        onChangeText: setDuration,
                        placeholder: "5:00",
                    }),
                    React.createElement(
                        RN.View,
                        { style: { flexDirection: "row", alignItems: "center", marginTop: 10 } },
                        React.createElement(RN.Text, { style: { color: "#f2f3f5", flex: 1 } }, "Missed call"),
                        React.createElement(RN.Switch, { value: missed, onValueChange: setMissed }),
                    ),
                    React.createElement(Button, { title: "Add fake call", onPress: doAddCall }),
                ),
            ),

            React.createElement(
                RN.View,
                { style: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#2b2d31" } },
                React.createElement(RN.Text, { style: { color: "#f2f3f5", fontSize: 17, fontWeight: "700" } }, `Saved entries (${fakes.length})`),
                rows.length
                    ? rows.map(fake => {
                        const author = fake.author?.globalName || fake.author?.username || fake.authorId;
                        const label = fake.call
                            ? `${fake.call.missed ? "Missed call" : "Call"} · ${formatDuration(fake.call.durationSeconds)}`
                            : `${author}: ${String(fake.content).slice(0, 60)}`;
                        return React.createElement(
                            RN.View,
                            { key: fake.id, style: { marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: "#1e1f22" } },
                            React.createElement(RN.Text, { style: { color: "#f2f3f5" } }, label),
                            React.createElement(RN.Text, { style: { color: "#949ba4", marginTop: 3, fontSize: 12 } }, `Channel ${fake.channelId}`),
                            React.createElement(Button, { title: "Remove", onPress: () => { removeFake(fake.id); forceUpdate(x => x + 1); } , danger: true }),
                        );
                    })
                    : React.createElement(RN.Text, { style: { color: "#949ba4", marginTop: 8 } }, "No fake entries saved."),
                React.createElement(Button, { title: "Clear all", onPress: () => { clearAll(); forceUpdate(x => x + 1); }, danger: true }),
            ),

            status ? React.createElement(RN.Text, { style: { color: "#b5bac1", marginTop: 12 } }, status) : null,

            React.createElement(
                RN.View,
                { style: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#2b2d31" } },
                React.createElement(
                    RN.View,
                    { style: { flexDirection: "row", alignItems: "center", marginTop: 6 } },
                    React.createElement(RN.Text, { style: { color: "#f2f3f5", flex: 1 } }, "Keep fake entries after restart"),
                    React.createElement(RN.Switch, {
                        value: settings.persist,
                        onValueChange: value => {
                            settings.persist = value;
                            save();
                            setStatus(value ? "Persistence enabled." : "Persistence disabled; current entries remain until cleared.");
                        },
                    }),
                ),
                React.createElement(
                    RN.View,
                    { style: { flexDirection: "row", alignItems: "center", marginTop: 10 } },
                    React.createElement(RN.Text, { style: { color: "#f2f3f5", flex: 1 } }, "Enable fake call logs"),
                    React.createElement(RN.Switch, {
                        value: settings.allowCalls,
                        onValueChange: value => {
                            settings.allowCalls = value;
                            save();
                        },
                    }),
                ),
            )
        );
    }

    function registerSettings() {
        if (ui?.settings?.registerSection) {
            try {
                unregisterSettings = ui.settings.registerSection({
                    name: NAME,
                    items: [
                        {
                            key: "fake-message",
                            title: () => NAME,
                            render: async () => ({ default: SettingsScreen }),
                        },
                    ],
                });
            } catch (e) {
                logger.warn("Could not register settings section", e);
            }
        }
    }

    function unregisterSettingsSection() {
        try { unregisterSettings?.(); } catch { /* noop */ }
        unregisterSettings = null;
    }

    return {
        onLoad() {
            if (mounted) return;
            mounted = true;
            load();
            installPatches();
            registerSettings();
            logger.info("Loaded");
            refresh();
        },

        onUnload() {
            if (!mounted) return;
            mounted = false;
            unregisterSettingsSection();
            uninstallPatches();
            logger.info("Unloaded");
        },

        settings: SettingsScreen,
    };
})()
