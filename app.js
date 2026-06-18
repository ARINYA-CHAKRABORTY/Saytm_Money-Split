// Initialize Lucide Icons initially
lucide.createIcons();

// --- STATE & DATA ---
let CURRENT_USER = localStorage.getItem('gaytm_user') || '';

// --- USER-SCOPED LOCALSTORAGE HELPERS ---
// All per-user data is stored under keys that include the user's name/email
// so switching accounts on the same device works correctly.
function userKey(key) {
    // Use saved user email or name as namespace. Falls back to global for initial load.
    const ns = localStorage.getItem('gaytm_active_user_ns') || '';
    return ns ? `gaytm_${ns}_${key}` : `gaytm_${key}`;
}

function setUserItem(key, value) {
    localStorage.setItem(userKey(key), value);
    // Also keep a global copy of the most important keys for quick startup
    if (key === 'group' || key === 'group_name') {
        localStorage.setItem(`gaytm_${key}`, value);
    }
}

function getUserItem(key) {
    const ns = localStorage.getItem('gaytm_active_user_ns') || '';
    if (ns) {
        const scoped = localStorage.getItem(`gaytm_${ns}_${key}`);
        if (scoped !== null) return scoped;
    }
    // Fallback to global key (legacy / first load)
    return localStorage.getItem(`gaytm_${key}`);
}

function removeUserItem(key) {
    localStorage.removeItem(userKey(key));
    localStorage.removeItem(`gaytm_${key}`); // also clear global
}

let CURRENT_GROUP = getUserItem('group') || '';
let CURRENT_GROUP_NAME = getUserItem('group_name') || '';

let isSigningIn = false;
let otpVerified = false;
let firebaseFallbackMode = false;

// Dynamic State Arrays (populated from group database)
let users = [];
let expenses = [];
let moments = [];

let selectedSplitUsers = [];
let momentImageBase64 = null;
let qrImageBase64 = null;
let joinRequests = [];
let groupAdmin = null;
let chartMode = 'who-owes-me';
let expenseImageBase64 = null;
let settlements = [];

// --- i18n TRANSLATIONS FALLBACK ---
const enTranslations = {
    'tab_pay_empty': 'Nothing to pay right now.',
    'tab_pay_you_owe': 'You Owe',
    'lbl_you_owe': 'You owe',
    'btn_pay': 'Pay',
    'tab_pay_owed_to_you': 'Owed to you',
    'lbl_owes_you': 'Owes you',
    'btn_nudge': 'Nudge',
    'btn_clear_due': 'Clear Due',
    'req_wants_join': 'wants to join the group',
    'btn_approve': 'Approve',
    'btn_reject': 'Reject'
};

function t(key) {
    return enTranslations[key] || key;
}

function formatAmt(val) {
    const amount = parseFloat(val);
    if (isNaN(amount)) return '₹0';
    const absVal = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';

    let formatted = "";
    if (absVal >= 10000000) { // 1 Crore
        formatted = (absVal / 10000000).toFixed(2).replace(/\.00$/, '') + " Crore";
    } else if (absVal >= 100000) { // 1 Lakh
        formatted = (absVal / 100000).toFixed(2).replace(/\.00$/, '') + " Lakh";
    } else {
        formatted = absVal.toFixed(2);
    }

    return sign + "₹" + formatted;
}
// Language support removed

// --- LOCAL STORAGE DATABASE SIMULATOR (Offline Demo) ---
function getDefaultAvatar(name) {
    const letter = (name || 'U').charAt(0).toUpperCase();
    const bgColors = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#2dd4bf', '#38bdf8', '#818cf8', '#a78bfa', '#e879f9', '#f43f5e'];
    let charCode = 0;
    if (name) {
        for (let i = 0; i < name.length; i++) charCode += name.charCodeAt(i);
    }
    const bgColor = bgColors[charCode % bgColors.length];

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect width="100" height="100" fill="${bgColor}"/>
        <text x="50" y="50" font-family="Inter, Arial, sans-serif" font-size="45" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="central">${letter}</text>
    </svg>`;

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getLocalDB() {
    let dbStr = localStorage.getItem('gaytm_local_db');
    let dbObj;
    if (!dbStr) {
        dbObj = { groups: {} };
        localStorage.setItem('gaytm_local_db', JSON.stringify(dbObj));
    } else {
        try {
            dbObj = JSON.parse(dbStr);
        } catch (e) {
            dbObj = { groups: {} };
        }
    }
    return dbObj;
}

function saveLocalDB(dbObj) {
    localStorage.setItem('gaytm_local_db', JSON.stringify(dbObj));
}

function handleGroupDeletedRealtime(groupCode) {
    removeFromUserGroupsList(groupCode);
    if (CURRENT_GROUP === groupCode) {
        alert(`The group "${CURRENT_GROUP_NAME || groupCode}" has been deleted by the admin.`);
        const myGroups = getUserGroupsList().filter(g => g.code !== groupCode);
        if (myGroups.length > 0) {
            const nextGroup = myGroups[myGroups.length - 1];
            CURRENT_GROUP = nextGroup.code;
            CURRENT_GROUP_NAME = nextGroup.name;
            setUserItem('group', CURRENT_GROUP);
            setUserItem('group_name', CURRENT_GROUP_NAME);
        } else {
            CURRENT_GROUP = '';
            CURRENT_GROUP_NAME = '';
            removeUserItem('group');
            removeUserItem('group_name');
        }
        removeUserItem('pending_request_group');
        initApp();
    }
}

// Called when the current user is detected to have been kicked from a group in real-time
function handleUserKickedRealtime(groupCode) {
    const kickedGroupName = CURRENT_GROUP_NAME || groupCode;

    // Remove this group from the user's tracked group list
    removeFromUserGroupsList(groupCode);

    // Clear any pending request markers for this group
    const pendingGroup = getUserItem('pending_request_group');
    if (pendingGroup === groupCode) {
        removeUserItem('pending_request_group');
    }

    // If the user is currently viewing the kicked group, route them away
    if (CURRENT_GROUP === groupCode) {
        alert(`You have been removed from the group "${kickedGroupName}" by the leader.`);

        // Switch to another available group, or clear
        const myGroups = getUserGroupsList().filter(g => g.code !== groupCode);
        if (myGroups.length > 0) {
            const nextGroup = myGroups[myGroups.length - 1];
            CURRENT_GROUP = nextGroup.code;
            CURRENT_GROUP_NAME = nextGroup.name;
            setUserItem('group', CURRENT_GROUP);
            setUserItem('group_name', CURRENT_GROUP_NAME);
        } else {
            CURRENT_GROUP = '';
            CURRENT_GROUP_NAME = '';
            removeUserItem('group');
            removeUserItem('group_name');
        }

        // Clear in-memory group data immediately so kicked user cannot interact
        users = [];
        expenses = [];
        moments = [];
        joinRequests = [];
        settlements = [];
        groupChats = [];

        // Unsubscribe any Firebase listeners to fully cut off access
        if (unsubscribeMembers) { unsubscribeMembers(); unsubscribeMembers = null; }
        if (unsubscribeExpenses) { unsubscribeExpenses(); unsubscribeExpenses = null; }
        if (unsubscribeMoments) { unsubscribeMoments(); unsubscribeMoments = null; }
        if (unsubscribeJoinRequests) { unsubscribeJoinRequests(); unsubscribeJoinRequests = null; }
        if (unsubscribeSettlements) { unsubscribeSettlements(); unsubscribeSettlements = null; }
        if (unsubscribeGroup) { unsubscribeGroup(); unsubscribeGroup = null; }
        if (unsubscribeChats) { unsubscribeChats(); unsubscribeChats = null; }

        // Close any open modals
        document.querySelectorAll('[id$="-modal"]:not(.hidden)').forEach(m => {
            m.classList.add('hidden');
        });

        initApp();
    }
}

function syncLocalGroupData() {
    if (usingFirebase) return;
    const dbObj = getLocalDB();
    if (CURRENT_GROUP && !dbObj.groups[CURRENT_GROUP]) {
        // In Firebase fallback mode (auth timed out), group data lives in Firestore,
        // not in local storage. Don't falsely trigger "group deleted" events.
        if (firebaseFallbackMode) {
            console.warn("Skipping group-deleted check: running in Firebase fallback mode. Group data is in Firestore, not local storage.");
            return;
        }
        handleGroupDeletedRealtime(CURRENT_GROUP);
        return;
    }
    const groupData = dbObj.groups[CURRENT_GROUP];
    if (groupData) {
        const freshMembers = groupData.members || [];

        // ── KICK DETECTION (local mode) ──────────────────────────────────────
        // If we previously had a valid group with members loaded and the current
        // user is no longer present in the updated member list, they were kicked.
        if (CURRENT_GROUP && CURRENT_USER && freshMembers.length > 0) {
            const stillMember = freshMembers.some(
                m => m.name.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase()
            );
            if (!stillMember) {
                handleUserKickedRealtime(CURRENT_GROUP);
                return;
            }
        }
        // ─────────────────────────────────────────────────────────────────────

        users = freshMembers;
        expenses = groupData.expenses || [];
        moments = groupData.moments || [];
        joinRequests = groupData.joinRequests || [];
        settlements = groupData.settlements || [];
        groupChats = groupData.chats || [];

        // Sync chat theme in local simulator mode
        const themeVal = groupData.chatTheme || 'default';
        if (themeVal !== CURRENT_CHAT_THEME) {
            CURRENT_CHAT_THEME = themeVal;
            const nameMap = {
                'default': 'Default',
                'ocean-gradient': 'Ocean Gradient',
                'neon-pink': 'Neon Pink',
                'cyberpunk': 'Cyberpunk'
            };
            const themeName = nameMap[CURRENT_CHAT_THEME] || 'Default';
            const themeNameEl = document.getElementById('fun-ui-selected-name');
            if (themeNameEl) themeNameEl.textContent = themeName;
        }
    } else {
        users = [];
        expenses = [];
        moments = [];
        joinRequests = [];
        groupChats = [];
    }

    const currentUserObj = users.find(u => u.name === CURRENT_USER);
    if (currentUserObj) {
        document.getElementById('header-avatar').src = currentUserObj.avatar;
        document.getElementById('profile-avatar-large').src = currentUserObj.avatar;
        document.getElementById('profile-upi').innerText = currentUserObj.upi || currentUserObj.upiPhone || 'Add your UPI';
    }

    renderDashboard();
    renderSplit();
    renderMoments();
    renderPay();
    renderGroupMembers();
    renderJoinRequests();
    checkFeedNotificationDot();
    if (isChatboxOpen && activeChatUser) {
        renderChatMessages();
    }
}

// Cross-tab kick detection for local simulator mode:
// When the leader kicks someone in Tab A, the DB update triggers a storage
// event in Tab B (the kicked user's tab), causing an immediate re-sync.
window.addEventListener('storage', (e) => {
    if (e.key === 'gaytm_local_db' && !usingFirebase) {
        // ── KICK DETECTION ─────────────────────────────────────────────────
        if (CURRENT_GROUP) {
            syncLocalGroupData();
        }
        // ── PENDING APPROVAL DETECTION ──────────────────────────────────────
        // Check if the current user was just approved into their pending group
        const pendingCode = getUserItem('pending_request_group');
        if (pendingCode && CURRENT_USER) {
            try {
                const dbObj = getLocalDB();
                const gd = dbObj.groups[pendingCode];
                if (gd && gd.members) {
                    const nowMember = gd.members.some(
                        m => m.name.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase()
                    );
                    if (nowMember) {
                        // We were approved! Switch to that group.
                        removeUserItem('pending_request_group');
                        removePendingGroup(pendingCode);
                        addToUserGroupsList(pendingCode, gd.name || pendingCode);
                        setUserItem('group', pendingCode);
                        setUserItem('group_name', gd.name || pendingCode);
                        CURRENT_GROUP = pendingCode;
                        CURRENT_GROUP_NAME = gd.name || pendingCode;
                        // Remove pending banner if visible
                        const banner = document.getElementById('pending-request-banner');
                        if (banner) banner.remove();
                        triggerConfetti();
                        initApp();
                    }
                }
            } catch (err) {
                console.error('Pending approval check error:', err);
            }
        }
    }
});

// --- FIREBASE SERVER SETUP ---
let usingFirebase = false;
let db = null;

// Your default Firebase project credentials
const defaultFirebaseConfig = {
    apiKey: "AIzaSyCwjQlNZsn0CpbzD2LADtyLDO8E0ZcrUHc",
    authDomain: "gaytm-16d0e.firebaseapp.com",
    projectId: "gaytm-16d0e",
    storageBucket: "gaytm-16d0e.firebasestorage.app",
    messagingSenderId: "859543423864",
    appId: "1:859543423864:web:f8c4f9211cca98ad11168d",
    measurementId: "G-3Y0K59VGLN"
};

const savedConfig = localStorage.getItem('gaytm_firebase_config');
const urlParams = new URLSearchParams(window.location.search);
const queryFirebaseDisabled = urlParams.get('firebase') === 'disabled' || urlParams.get('gaytm_firebase_disabled') === 'true';
const firebaseDisabled = localStorage.getItem('gaytm_firebase_disabled') === 'true' || queryFirebaseDisabled;
let configToUse = null;

if (savedConfig) {
    try {
        configToUse = JSON.parse(savedConfig);
    } catch (e) {
        console.error("Error parsing saved Firebase config:", e);
    }
}

// Use the hardcoded config if no config was manually saved in settings AND firebase is not explicitly disabled
if (!firebaseDisabled && (!configToUse || !configToUse.apiKey)) {
    configToUse = defaultFirebaseConfig;
}

if (configToUse && configToUse.apiKey && configToUse.projectId) {
    try {
        firebase.initializeApp(configToUse);
        db = firebase.firestore();
        usingFirebase = true;
    } catch (e) {
        console.error("Firebase initialization failed:", e);
    }
}

// --- EMAILJS INITIALIZATION ---
const defaultEmailJSConfig = {
    serviceId: "service_3by2m7f",
    templateId: "template_jxdorhc",
    publicKey: "n9akhDmB4M38o29H-"
};

const EMAILJS_SERVICE = localStorage.getItem('gaytm_emailjs_service_id') || defaultEmailJSConfig.serviceId;
const EMAILJS_TEMPLATE = localStorage.getItem('gaytm_emailjs_template_id') || defaultEmailJSConfig.templateId;
const EMAILJS_PUBLIC_KEY = localStorage.getItem('gaytm_emailjs_public_key') || defaultEmailJSConfig.publicKey;

if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY) {
    try {
        emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    } catch (e) {
        console.error("EmailJS initialization failed:", e);
    }
}

// --- FIREBASE HELPER METHODS ---

function initFirebaseInputs() {
    const statusEl = document.getElementById('firebase-status-text');
    if (!statusEl) return;

    // Load saved EmailJS settings
    document.getElementById('fb-emService').value = localStorage.getItem('gaytm_emailjs_service_id') || defaultEmailJSConfig.serviceId;
    document.getElementById('fb-emTemplate').value = localStorage.getItem('gaytm_emailjs_template_id') || defaultEmailJSConfig.templateId;
    document.getElementById('fb-emPublicKey').value = localStorage.getItem('gaytm_emailjs_public_key') || defaultEmailJSConfig.publicKey;

    if (usingFirebase) {
        statusEl.innerText = "Firebase Cloud Connected";
        statusEl.className = "text-xs font-semibold text-emerald-600";

        const config = JSON.parse(localStorage.getItem('gaytm_firebase_config') || JSON.stringify(defaultFirebaseConfig));
        document.getElementById('fb-apiKey').value = config.apiKey || '';
        document.getElementById('fb-projectId').value = config.projectId || '';
        document.getElementById('fb-authDomain').value = config.authDomain || '';
        document.getElementById('fb-messagingSenderId').value = config.messagingSenderId || '';
        document.getElementById('fb-appId').value = config.appId || '';
    } else {
        statusEl.innerText = "Using Local Mock Database";
        statusEl.className = "text-xs text-zinc-500";
    }
}

function saveFirebaseConfig() {
    const apiKey = document.getElementById('fb-apiKey').value.trim();
    const projectId = document.getElementById('fb-projectId').value.trim();
    const authDomain = document.getElementById('fb-authDomain').value.trim();
    const messagingSenderId = document.getElementById('fb-messagingSenderId').value.trim();
    const appId = document.getElementById('fb-appId').value.trim();

    const emService = document.getElementById('fb-emService').value.trim();
    const emTemplate = document.getElementById('fb-emTemplate').value.trim();
    const emPublicKey = document.getElementById('fb-emPublicKey').value.trim();

    if (apiKey || projectId) {
        if (!apiKey || !projectId) {
            alert("API Key and Project ID are required to save Firebase config!");
            return;
        }
        const config = { apiKey, projectId, authDomain, messagingSenderId, appId };
        localStorage.setItem('gaytm_firebase_config', JSON.stringify(config));
        localStorage.removeItem('gaytm_firebase_disabled');
    }

    if (emService) localStorage.setItem('gaytm_emailjs_service_id', emService);
    else localStorage.removeItem('gaytm_emailjs_service_id');

    if (emTemplate) localStorage.setItem('gaytm_emailjs_template_id', emTemplate);
    else localStorage.removeItem('gaytm_emailjs_template_id');

    if (emPublicKey) localStorage.setItem('gaytm_emailjs_public_key', emPublicKey);
    else localStorage.removeItem('gaytm_emailjs_public_key');

    alert("Configuration settings saved! Page will now reload...");
    location.reload();
}

function clearFirebaseConfig() {
    localStorage.removeItem('gaytm_firebase_config');
    localStorage.setItem('gaytm_firebase_disabled', 'true');
    localStorage.removeItem('gaytm_emailjs_service_id');
    localStorage.removeItem('gaytm_emailjs_template_id');
    localStorage.removeItem('gaytm_emailjs_public_key');
    alert("Configurations cleared. Page will reload to local demo mode...");
    location.reload();
}

function formatDate(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

let unsubscribeMembers = null;
let unsubscribeExpenses = null;
let unsubscribeMoments = null;
let unsubscribeJoinRequests = null;
let unsubscribeSettlements = null;
let unsubscribeGroup = null;
let unsubscribeChats = null;
let groupChats = [];
let activeChatUser = null;
let activeChatUid = null;
let isChatboxOpen = false;
let CURRENT_CHAT_THEME = 'default';

function startFirebaseSync() {
    if (!usingFirebase || !CURRENT_GROUP) return;

    groupAdmin = null; // Reset cached admin on new group sync

    // Unsubscribe existing listeners if any
    if (unsubscribeMembers) unsubscribeMembers();
    if (unsubscribeExpenses) unsubscribeExpenses();
    if (unsubscribeMoments) unsubscribeMoments();
    if (unsubscribeJoinRequests) unsubscribeJoinRequests();
    if (unsubscribeSettlements) unsubscribeSettlements();
    if (unsubscribeGroup) unsubscribeGroup();
    if (unsubscribeChats) unsubscribeChats();

    const groupRef = db.collection("groups").doc(CURRENT_GROUP);

    // Sync Group Doc to detect real-time deletion and chat themes
    unsubscribeGroup = groupRef.onSnapshot((doc) => {
        if (!doc.exists) {
            handleGroupDeletedRealtime(CURRENT_GROUP);
        } else {
            const data = doc.data();
            if (data.chatTheme && data.chatTheme !== CURRENT_CHAT_THEME) {
                CURRENT_CHAT_THEME = data.chatTheme;
                const nameMap = {
                    'default': 'Default',
                    'ocean-gradient': 'Ocean Gradient',
                    'neon-pink': 'Neon Pink',
                    'cyberpunk': 'Cyberpunk'
                };
                const themeName = nameMap[CURRENT_CHAT_THEME] || 'Default';
                const themeNameEl = document.getElementById('fun-ui-selected-name');
                if (themeNameEl) themeNameEl.textContent = themeName;
                if (isChatboxOpen) {
                    renderChatMessages();
                }
            }
        }
    }, (error) => {
        console.error("Firestore group sync error:", error);
    });

    // Cache the group admin for join request rendering
    groupRef.get().then((doc) => {
        if (doc.exists) {
            groupAdmin = doc.data().createdBy || null;
            renderJoinRequests(); // Re-render now that we know who's admin
        }
    }).catch(() => { });

    // Sync Group Members
    unsubscribeMembers = groupRef.collection("members").onSnapshot((snapshot) => {
        const freshMembers = [];
        snapshot.forEach((doc) => {
            freshMembers.push(doc.data());
        });

        // ── KICK DETECTION (Firebase mode) ──────────────────────────────────
        // If the snapshot has members loaded (not an empty initial state)
        // and the current authenticated user is no longer in the list, they were kicked.
        if (freshMembers.length > 0 && CURRENT_GROUP && CURRENT_USER) {
            const currentAuthUser = firebase.auth().currentUser;
            const currentUid = currentAuthUser ? currentAuthUser.uid : null;
            const stillMember = freshMembers.some(m => {
                if (currentUid) return m.uid === currentUid;
                return m.name.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase();
            });
            if (!stillMember) {
                handleUserKickedRealtime(CURRENT_GROUP);
                return; // Stop processing — user has been kicked
            }
        }
        // ────────────────────────────────────────────────────────────────────

        users = freshMembers;
        renderSplitUsers(); // Redraw checkbox options in split bill modal
        renderPay();        // Redraw group list on Pay tab
        renderGroupMembers(); // Redraw group member chips on Dashboard

        // Keep avatar in sync
        const currentUserObj = users.find(u => usingFirebase ? (u.uid === (firebase.auth().currentUser ? firebase.auth().currentUser.uid : '')) : (u.name === CURRENT_USER));
        if (currentUserObj) {
            document.getElementById('header-avatar').src = currentUserObj.avatar;
            document.getElementById('profile-avatar-large').src = currentUserObj.avatar;
            document.getElementById('profile-upi').innerText = currentUserObj.upi || currentUserObj.upiPhone || 'Add your UPI';
        }
    }, (error) => {
        console.error("Firestore members sync error:", error);
    });

    // Sync Expenses from Cloud Firestore
    unsubscribeExpenses = groupRef.collection("expenses").orderBy("timestamp", "desc").onSnapshot((snapshot) => {
        expenses = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            expenses.push({
                id: doc.id,
                desc: data.desc,
                comment: data.comment,
                amount: parseFloat(data.amount) || 0,
                paidBy: data.paidBy,
                splitWith: data.splitWith || [],
                category: data.category || 'Others',
                comments: data.comments || [],
                image: data.image || null,
                date: data.timestamp ? formatDate(data.timestamp.toDate()) : 'Just now'
            });
        });
        renderDashboard();
        renderSplit();
        renderPay();
    }, (error) => {
        console.error("Firestore sync error:", error);
        alert("Firebase Error: check your console. Make sure database is in Test Mode.");
    });

    // Sync Moments from Cloud Firestore
    unsubscribeMoments = groupRef.collection("moments").orderBy("timestamp", "desc").onSnapshot((snapshot) => {
        moments = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            moments.push({
                id: doc.id,
                user: data.user,
                caption: data.caption,
                image: data.image,
                likes: data.likes || [],
                comments: data.comments || [],
                timestamp: data.timestamp ? data.timestamp.toMillis() : Date.now(),
                time: data.timestamp ? formatDate(data.timestamp.toDate()) : 'Just now'
            });
        });
        renderMoments();
        checkFeedNotificationDot();
    }, (error) => {
        console.error("Firestore moments sync error:", error);
    });

    // Sync Join Requests from Cloud Firestore
    unsubscribeJoinRequests = groupRef.collection("joinRequests").onSnapshot((snapshot) => {
        joinRequests = [];
        snapshot.forEach((doc) => {
            joinRequests.push({ id: doc.id, ...doc.data() });
        });
        renderJoinRequests();
    }, (error) => {
        console.error("Firestore joinRequests sync error:", error);
    });

    // Sync Settlements
    unsubscribeSettlements = groupRef.collection("settlements").onSnapshot((snapshot) => {
        settlements = [];
        snapshot.forEach((doc) => {
            settlements.push(doc.data());
        });
        renderPay();
        renderDashboard();
    }, () => { /* silent fail */ });

    // Sync Chats from Cloud Firestore
    unsubscribeChats = groupRef.collection("chats").orderBy("timestamp", "asc").onSnapshot((snapshot) => {
        groupChats = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            groupChats.push({
                id: doc.id,
                from: data.from,
                to: data.to,
                text: data.text,
                timestamp: data.timestamp ? data.timestamp.toMillis() : Date.now()
            });
        });
        renderGroupMembers();
        updateHomeNotificationDot();
        if (isChatboxOpen && activeChatUser) {
            renderChatMessages();
        }
    }, (error) => {
        console.error("Firestore chats sync error:", error);
    });
}

// --- APP FLOW LOGIC (Login, Join, Create, Switch) ---

// --- OTP VERIFICATION FLOW ---
let generatedOTP = '';
let otpPurpose = '';
let pendingAuthData = null;

function sendEmailOTP(name, email, purpose, authData) {
    generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();
    window.__last_otp = generatedOTP; // Store for easy testing/debugging
    otpPurpose = purpose;
    pendingAuthData = authData;

    const emailServiceId = EMAILJS_SERVICE;
    const emailTemplateId = EMAILJS_TEMPLATE;
    const emailPublicKey = EMAILJS_PUBLIC_KEY;

    // Open the OTP Modal
    openModal('otp-modal');

    // Clear previous inputs
    const inputs = document.querySelectorAll('.otp-input');
    inputs.forEach(input => input.value = '');
    inputs[0].focus();

    if (emailServiceId && emailTemplateId && emailPublicKey && typeof emailjs !== 'undefined') {
        document.getElementById('otp-description').innerText = `We sent a 6-digit verification code to ${email}.`;
        // Send actual Email via EmailJS
        emailjs.send(emailServiceId, emailTemplateId, {
            to_name: name,
            to_email: email,
            otp_code: generatedOTP
        }, emailPublicKey)
            .then(() => {
                console.log("OTP Email sent successfully via EmailJS.");
            })
            .catch(err => {
                console.error("EmailJS sending failed:", err);
                document.getElementById('otp-description').innerText = `Failed to send email. Please check your EmailJS configuration.`;
                alert("Failed to send verification email. Please check your EmailJS settings or internet connection.");
            });
    } else {
        // EmailJS not configured or blocked
        document.getElementById('otp-description').innerText = `Email service unavailable.`;
        alert("Email service is currently unavailable. Please check your EmailJS configuration in the Advanced Settings.");
    }
}

function verifyOTP() {
    const inputs = document.querySelectorAll('.otp-input');
    let enteredOTP = '';
    inputs.forEach(input => enteredOTP += input.value);

    if (enteredOTP.length < 6) {
        alert('Please enter all 6 digits.');
        return;
    }

    if (enteredOTP !== generatedOTP) {
        alert('Incorrect OTP. Please try again.');
        return;
    }

    // Correct OTP! Let's complete the action
    closeModal('otp-modal');
    otpVerified = true;

    const loader = document.getElementById('loader-view');
    const loaderText = document.getElementById('loading-text');
    loader.classList.remove('hidden');
    loader.classList.remove('opacity-0');

    if (otpPurpose === 'signup') {
        loaderText.innerText = "Creating account...";
        const { name, email, password } = pendingAuthData;

        if (usingFirebase) {
            firebase.auth().createUserWithEmailAndPassword(email, password)
                .then((userCredential) => {
                    const user = userCredential.user;
                    return user.updateProfile({
                        displayName: name
                    }).then(() => {
                        CURRENT_USER = name;
                        localStorage.setItem('gaytm_user', name);
                        localStorage.setItem('gaytm_user_email', email);

                        setTimeout(() => {
                            loader.classList.add('opacity-0');
                            setTimeout(() => loader.classList.add('hidden'), 400);
                        }, 1000);
                    });
                })
                .catch((error) => {
                    loader.classList.add('hidden');
                    otpVerified = false;
                    if (error.code === 'auth/email-already-in-use') {
                        if (confirm("Account already exists. Do you want to sign in instead?")) {
                            toggleAuthMode(true);
                            document.getElementById('login-email').value = email;
                        }
                    } else {
                        alert("Sign up failed: " + error.message);
                    }
                });
        } else {
            // Offline Simulator Mode signup completion
            setTimeout(() => {
                const localUsers = JSON.parse(localStorage.getItem('gaytm_local_users') || '{}');
                localUsers[email.toLowerCase()] = {
                    name: name,
                    password: password
                };
                localStorage.setItem('gaytm_local_users', JSON.stringify(localUsers));

                CURRENT_USER = name;
                localStorage.setItem('gaytm_user', CURRENT_USER);
                localStorage.setItem('gaytm_user_email', email);

                loader.classList.add('opacity-0');
                setTimeout(() => {
                    loader.classList.add('hidden');
                    document.getElementById('login-view').classList.add('hidden');
                    document.getElementById('main-app').classList.remove('hidden');
                    initApp();
                }, 400);
            }, 1000);
        }
    } else if (otpPurpose === 'login') {
        loaderText.innerText = "Completing authentication...";
        const { name, email } = pendingAuthData;

        if (usingFirebase) {
            try {
                // In Firebase, we already logged in during intercept. So we just route now.
                CURRENT_USER = name;
                // Set user namespace using email so data is scoped per account
                const userNs = (email || name).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                localStorage.setItem('gaytm_active_user_ns', userNs);
                localStorage.setItem('gaytm_user', CURRENT_USER);
                localStorage.setItem('gaytm_user_email', email);

                document.getElementById('login-view').classList.add('hidden');
                document.getElementById('main-app').classList.remove('hidden');

                const storedGroup = getUserItem('group');
                if (storedGroup) {
                    CURRENT_GROUP = storedGroup;
                    CURRENT_GROUP_NAME = getUserItem('group_name') || storedGroup;
                } else {
                    CURRENT_GROUP = '';
                    CURRENT_GROUP_NAME = '';
                }
                initApp();

                setTimeout(() => {
                    loader.classList.add('opacity-0');
                    setTimeout(() => loader.classList.add('hidden'), 400);
                }, 1000);
            } catch (err) {
                console.error("Firebase Auth completion error:", err);
                loader.classList.add('hidden');
                alert("Error completing authentication: " + err.message);
            }
        } else {
            // Offline Simulator Mode login completion
            setTimeout(() => {
                try {
                    CURRENT_USER = name;
                    // Scope localStorage to this user's email
                    const userNs = (email || name).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                    localStorage.setItem('gaytm_active_user_ns', userNs);
                    localStorage.setItem('gaytm_user', CURRENT_USER);
                    localStorage.setItem('gaytm_user_email', email);
                } catch (e) {
                    console.error("Error in verifyOTP:", e);
                    loader.classList.add('hidden');
                    alert("Authentication error: " + e.message);
                    return;
                }

                loader.classList.add('opacity-0');
                setTimeout(() => {
                    loader.classList.add('hidden');
                    document.getElementById('login-view').classList.add('hidden');
                    document.getElementById('main-app').classList.remove('hidden');

                    const storedGroup = getUserItem('group');
                    if (storedGroup) {
                        CURRENT_GROUP = storedGroup;
                        CURRENT_GROUP_NAME = getUserItem('group_name') || storedGroup;
                    } else {
                        CURRENT_GROUP = '';
                        CURRENT_GROUP_NAME = '';
                    }
                    try {
                        initApp();
                    } catch (e) {
                        console.error("Error in initApp:", e);
                        alert("App initialization error: " + e.message);
                    }
                }, 400);
            }, 1000);
        }
    } else if (otpPurpose === 'reset_password') {
        loader.classList.add('hidden');
        closeModal('otp-modal');
        setTimeout(() => {
            openModal('reset-password-modal');
        }, 300);
    }
}

function resendOTP() {
    if (!pendingAuthData) return;
    const name = pendingAuthData.name || pendingAuthData.email.split('@')[0];
    sendEmailOTP(name, pendingAuthData.email, otpPurpose, pendingAuthData);
}

function setupOTPInputBehavior() {
    const inputs = document.querySelectorAll('.otp-input');
    inputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            // Only allow numbers
            input.value = input.value.replace(/[^0-9]/g, '');

            if (input.value.length === 1 && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && input.value.length === 0 && index > 0) {
                inputs[index - 1].focus();
            }
        });
    });
}
// Call behavior setup directly
setupOTPInputBehavior();

function togglePasswordVisibility(inputElId, btn) {
    const input = document.getElementById(inputElId);
    if (!input) return;
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) {
            icon.setAttribute('data-lucide', 'eye-off');
        }
    } else {
        input.type = 'password';
        if (icon) {
            icon.setAttribute('data-lucide', 'eye');
        }
    }
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

function toggleAuthMode(showLogin) {
    if (showLogin) {
        document.getElementById('auth-login-container').classList.remove('hidden');
        document.getElementById('auth-signup-container').classList.add('hidden');
    } else {
        document.getElementById('auth-login-container').classList.add('hidden');
        document.getElementById('auth-signup-container').classList.remove('hidden');
    }
}

function login() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();

    if (!email || !password) {
        alert('Please enter your email and password.');
        return;
    }

    const loader = document.getElementById('loader-view');
    const loaderText = document.getElementById('loading-text');
    loader.classList.remove('hidden');
    loader.classList.remove('opacity-0');
    loaderText.innerText = "Authenticating...";

    isSigningIn = true;
    otpVerified = false;

    if (usingFirebase) {
        firebase.auth().signInWithEmailAndPassword(email, password)
            .then((userCredential) => {
                // UI transition is intercepted/handled by onAuthStateChanged listener
                setTimeout(() => {
                    loader.classList.add('opacity-0');
                    setTimeout(() => loader.classList.add('hidden'), 400);
                }, 1000);
            })
            .catch((error) => {
                loader.classList.add('hidden');
                isSigningIn = false;
                alert("Login failed: " + error.message);
            });
    } else {
        // Offline Local Simulator Mode
        const localUsers = JSON.parse(localStorage.getItem('gaytm_local_users') || '{}');
        const user = localUsers[email.toLowerCase()];

        if (user && user.password === password) {
            // Password verified — skip OTP for returning users, log in directly
            setTimeout(() => {
                try {
                    CURRENT_USER = user.name;
                    const userNs = (email || user.name).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                    localStorage.setItem('gaytm_active_user_ns', userNs);
                    localStorage.setItem('gaytm_user', CURRENT_USER);
                    localStorage.setItem('gaytm_user_email', email);
                } catch (e) {
                    loader.classList.add('hidden');
                    isSigningIn = false;
                    alert('Login error: ' + e.message);
                    return;
                }

                loader.classList.add('opacity-0');
                setTimeout(() => {
                    loader.classList.add('hidden');
                    document.getElementById('login-view').classList.add('hidden');
                    document.getElementById('main-app').classList.remove('hidden');

                    const storedGroup = getUserItem('group');
                    if (storedGroup) {
                        CURRENT_GROUP = storedGroup;
                        CURRENT_GROUP_NAME = getUserItem('group_name') || storedGroup;
                    } else {
                        CURRENT_GROUP = '';
                        CURRENT_GROUP_NAME = '';
                    }
                    try {
                        initApp();
                    } catch (e) {
                        console.error('Error in initApp:', e);
                        alert('App initialization error: ' + e.message);
                    }
                }, 400);
            }, 800);
        } else {
            setTimeout(() => {
                loader.classList.add('hidden');
                isSigningIn = false;
                alert('Login failed: Invalid email or password.');
            }, 1000);
        }
    }
}

function signUp() {
    const nameInput = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value.trim();

    if (!nameInput || !email || !password) {
        alert('Please fill in all fields.');
        return;
    }

    if (password.length < 6) {
        alert('Password must be at least 6 characters.');
        return;
    }

    // Capitalize first letter
    const username = nameInput.charAt(0).toUpperCase() + nameInput.slice(1);

    // Check if email already registered in local mock mode
    if (!usingFirebase) {
        const localUsers = JSON.parse(localStorage.getItem('gaytm_local_users') || '{}');
        if (localUsers[email.toLowerCase()]) {
            if (confirm("Account already exists. Do you want to sign in instead?")) {
                toggleAuthMode(true);
                document.getElementById('login-email').value = email;
            }
            return;
        }
    }

    // Intercept to OTP step
    sendEmailOTP(username, email, 'signup', { name: username, email, password });
}

function joinGroup() {
    const codeInput = document.getElementById('join-group-code').value.trim();
    if (!codeInput) {
        alert("Please enter a group code!");
        return;
    }
    const groupCode = codeInput.toUpperCase();

    // If we're in Firebase fallback mode, warn the user that joining won't work reliably
    if (firebaseFallbackMode && !usingFirebase) {
        alert("⚠️ Firebase is currently unreachable (auth timed out). Please reload the page and try again. If the problem persists, check your internet connection.");
        return;
    }

    if (usingFirebase) {
        const groupRef = db.collection("groups").doc(groupCode);
        groupRef.get().then((doc) => {
            if (!doc.exists) {
                alert("No group found with code: " + groupCode + ". Ask the group creator for the correct code.");
                return;
            }

            const groupName = doc.data().name || (groupCode + " Group");
            const currentUser = firebase.auth().currentUser;
            const memberId = currentUser ? currentUser.uid : CURRENT_USER;

            // Check if already a member
            groupRef.collection("members").doc(memberId).get().then((memberDoc) => {
                if (memberDoc.exists) {
                    // Already a member — just switch to this group
                    addToUserGroupsList(groupCode, groupName);
                    setUserItem('group', groupCode);
                    setUserItem('group_name', groupName);
                    CURRENT_GROUP = groupCode;
                    CURRENT_GROUP_NAME = groupName;
                    initApp();
                    return;
                }

                // Check group member limit first
                const memberLimit = doc.data().memberLimit || 0;
                groupRef.collection("members").get().then((membersSnap) => {
                    if (memberLimit > 0 && membersSnap.size >= memberLimit) {
                        alert("This group has reached its maximum member limit of " + memberLimit + "!");
                        return;
                    }

                    // Not a member — send join request
                    const globalUpi = getUserItem('global_upi') || '';
                    const globalUpiPhone = getUserItem('global_upi_phone') || '';
                    const globalQr = getUserItem('global_qr') || '';
                    const requestObj = {
                        uid: currentUser ? currentUser.uid : '',
                        name: CURRENT_USER,
                        email: currentUser ? currentUser.email : '',
                        avatar: getDefaultAvatar(CURRENT_USER),
                        requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        upi: globalUpi,
                        upiPhone: globalUpiPhone,
                        qrImage: globalQr || ''
                    };

                    groupRef.collection("joinRequests").doc(memberId).set(requestObj).then(() => {
                        setUserItem('pending_request_group', groupCode);
                        addPendingGroup(groupCode, groupName);
                        alert("✅ Join request sent! The group admin needs to approve your request for: " + groupName);
                        document.getElementById('join-group-code').value = '';
                        initApp(); // re-route to show pending banner
                    }).catch(err => {
                        alert("Error sending join request: " + err.message);
                    });
                });
            }).catch(err => {
                alert("Error checking membership: " + err.message);
            });
        }).catch(err => {
            alert("Error joining group: " + err.message);
        });
    } else {
        // Offline LocalStorage Simulator
        const dbObj = getLocalDB();
        if (!dbObj.groups[groupCode]) {
            alert("No group found with code: " + groupCode + ". Ask the group creator for the correct code.");
            return;
        }
        const groupData = dbObj.groups[groupCode];

        // Check if already a member
        if (groupData.members.some(m => m.name.toLowerCase() === CURRENT_USER.toLowerCase())) {
            // Already a member, just switch to it
            addToUserGroupsList(groupCode, groupData.name);
            setUserItem('group', groupCode);
            setUserItem('group_name', groupData.name);
            CURRENT_GROUP = groupCode;
            CURRENT_GROUP_NAME = groupData.name;
            initApp();
            return;
        }

        // Check group member limit first
        const memberLimit = groupData.memberLimit || 0;
        if (memberLimit > 0 && groupData.members.length >= memberLimit) {
            alert("This group has reached its maximum member limit of " + memberLimit + "!");
            return;
        }

        // Check if already requested
        if (!groupData.joinRequests) groupData.joinRequests = [];
        if (groupData.joinRequests.some(r => r.name.toLowerCase() === CURRENT_USER.toLowerCase())) {
            alert("You've already sent a join request for this group. Please wait for the admin to approve.");
            return;
        }

        const globalUpi = getUserItem('global_upi') || '';
        const globalUpiPhone = getUserItem('global_upi_phone') || '';
        const globalQr = getUserItem('global_qr') || '';
        const requestObj = {
            name: CURRENT_USER,
            avatar: getDefaultAvatar(CURRENT_USER),
            requestedAt: new Date().toISOString(),
            upi: globalUpi,
            upiPhone: globalUpiPhone,
            qrImage: globalQr || ''
        };

        groupData.joinRequests.push(requestObj);
        saveLocalDB(dbObj);
        setUserItem('pending_request_group', groupCode);
        addPendingGroup(groupCode, groupData.name);
        alert("Join request sent! The group creator needs to approve your request.");
        document.getElementById('join-group-code').value = '';
        initApp(); // re-route to show pending banner
    }
}

function createGroup() {
    const groupNameInput = document.getElementById('create-group-name').value.trim();
    const groupCodeInput = document.getElementById('create-group-code').value.trim();

    if (!groupNameInput) {
        alert("Please enter a group name!");
        return;
    }

    // Generate a code if left blank
    let groupCode = groupCodeInput.toUpperCase();
    if (!groupCode) {
        groupCode = "G" + Math.random().toString(36).substr(2, 5).toUpperCase();
    }

    // Warn if creating a group while Firebase is unreachable — the group would
    // only exist locally and won't be accessible from other devices.
    if (firebaseFallbackMode && !usingFirebase) {
        alert("⚠️ Firebase is currently unreachable. Groups created now will only exist on this device. Please reload the page and try again.");
        return;
    }

    if (usingFirebase) {
        const groupRef = db.collection("groups").doc(groupCode);
        // Check if group code already exists
        groupRef.get().then((doc) => {
            if (doc.exists) {
                alert("This group code is already taken! Try a different code.");
                return;
            }

            const currentUser = firebase.auth().currentUser;
            groupRef.set({
                name: groupNameInput,
                createdBy: CURRENT_USER,
                createdByEmail: currentUser ? currentUser.email : '',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                memberLimit: 0 // default unlimited
            }).then(() => {
                const currentUser = firebase.auth().currentUser;
                const globalUpi = getUserItem('global_upi') || '';
                const globalUpiPhone = getUserItem('global_upi_phone') || '';
                const globalQr = getUserItem('global_qr') || '';
                const newUserObj = {
                    uid: currentUser ? currentUser.uid : '',
                    name: CURRENT_USER,
                    upi: globalUpi,
                    upiPhone: globalUpiPhone,
                    avatar: getDefaultAvatar(CURRENT_USER)
                };
                if (globalQr) {
                    newUserObj.qrImage = globalQr;
                }
                const memberId = currentUser ? currentUser.uid : CURRENT_USER;
                return groupRef.collection("members").doc(memberId).set(newUserObj);
            }).then(() => {
                const emailToSave = currentUser ? currentUser.email : '';
                addToUserGroupsList(groupCode, groupNameInput, emailToSave, CURRENT_USER);
                setUserItem('group', groupCode);
                setUserItem('group_name', groupNameInput);
                CURRENT_GROUP = groupCode;
                CURRENT_GROUP_NAME = groupNameInput;

                initApp();
            }).catch(err => {
                alert("Error creating group: " + err.message);
            });
        }).catch(err => {
            alert("Error checking group code: " + err.message);
        });
    } else {
        // Offline LocalStorage Simulator
        const dbObj = getLocalDB();
        if (dbObj.groups[groupCode]) {
            alert("This group code is already taken! Try a different code.");
            return;
        }

        const globalUpi = getUserItem('global_upi') || '';
        const globalUpiPhone = getUserItem('global_upi_phone') || '';
        const globalQr = getUserItem('global_qr') || '';
        const firstMember = {
            name: CURRENT_USER,
            upi: globalUpi,
            upiPhone: globalUpiPhone,
            avatar: getDefaultAvatar(CURRENT_USER)
        };
        if (globalQr) {
            firstMember.qrImage = globalQr;
        }

        dbObj.groups[groupCode] = {
            name: groupNameInput,
            createdBy: CURRENT_USER,
            createdByEmail: localStorage.getItem('gaytm_user_email') || '',
            createdAt: new Date().toISOString(),
            memberLimit: 0, // default unlimited
            members: [firstMember],
            expenses: [],
            moments: [],
            settlements: [],
            joinRequests: []
        };
        saveLocalDB(dbObj);

        const emailToSave = localStorage.getItem('gaytm_user_email') || '';
        addToUserGroupsList(groupCode, groupNameInput, emailToSave, CURRENT_USER);
        setUserItem('group', groupCode);
        setUserItem('group_name', groupNameInput);
        CURRENT_GROUP = groupCode;
        CURRENT_GROUP_NAME = groupNameInput;

        initApp();
    }
}

// --- USER GROUPS LIST MANAGEMENT ---
function getUserGroupsList() {
    try {
        return JSON.parse(getUserItem('user_groups') || '[]');
    } catch (e) {
        return [];
    }
}

function addToUserGroupsList(code, name, createdByEmail = '', createdBy = '') {
    const groups = getUserGroupsList();
    const existing = groups.find(g => g.code === code);
    if (!existing) {
        groups.push({ code, name, createdByEmail, createdBy });
        setUserItem('user_groups', JSON.stringify(groups));
    } else {
        if (createdByEmail && (!existing.createdByEmail || !existing.createdBy)) {
            existing.createdByEmail = createdByEmail;
            existing.createdBy = createdBy;
            setUserItem('user_groups', JSON.stringify(groups));
        }
    }
}

function updateLocalUserGroupCreator(code, createdByEmail, createdBy) {
    let groups = getUserGroupsList();
    let updated = false;
    groups.forEach(g => {
        if (g.code === code) {
            if (g.createdByEmail !== createdByEmail || g.createdBy !== createdBy) {
                g.createdByEmail = createdByEmail;
                g.createdBy = createdBy;
                updated = true;
            }
        }
    });
    if (updated) {
        setUserItem('user_groups', JSON.stringify(groups));
    }
}

function removeFromUserGroupsList(code) {
    let groups = getUserGroupsList();
    groups = groups.filter(g => g.code !== code);
    setUserItem('user_groups', JSON.stringify(groups));
}

function getPendingGroups() {
    try {
        return JSON.parse(getUserItem('pending_groups') || '[]');
    } catch (e) {
        return [];
    }
}

function addPendingGroup(code, name, createdByEmail = '', createdBy = '') {
    const groups = getPendingGroups();
    const existing = groups.find(g => g.code === code);
    if (!existing) {
        groups.push({ code, name, createdByEmail, createdBy });
        setUserItem('pending_groups', JSON.stringify(groups));
    } else {
        if (createdByEmail && (!existing.createdByEmail || !existing.createdBy)) {
            existing.createdByEmail = createdByEmail;
            existing.createdBy = createdBy;
            setUserItem('pending_groups', JSON.stringify(groups));
        }
    }
}

function removePendingGroup(code) {
    let groups = getPendingGroups();
    groups = groups.filter(g => g.code !== code);
    setUserItem('pending_groups', JSON.stringify(groups));
}

// --- PENDING REQUEST BANNER ---
let pendingApprovalListener = null;

// Starts a real-time watcher for a pending join-request approval.
// Works in BOTH Firebase mode (Firestore onSnapshot) and local mode
// (the storage event already handles it; this handles the Firebase path).
function startPendingApprovalWatch(groupCode) {
    if (!groupCode || !CURRENT_USER) return;

    if (usingFirebase && db) {
        // Firebase: listen on the user's member doc in the pending group.
        // When it appears, they've been approved.
        if (pendingApprovalListener) {
            pendingApprovalListener();
            pendingApprovalListener = null;
        }
        const memberId = firebase.auth().currentUser?.uid || CURRENT_USER;
        pendingApprovalListener = db
            .collection('groups').doc(groupCode)
            .collection('members').doc(memberId)
            .onSnapshot(doc => {
                if (doc.exists) {
                    // Approved!
                    if (pendingApprovalListener) {
                        pendingApprovalListener();
                        pendingApprovalListener = null;
                    }
                    removeUserItem('pending_request_group');
                    removePendingGroup(groupCode);
                    db.collection('groups').doc(groupCode).get().then(gDoc => {
                        const gName = gDoc.exists ? (gDoc.data().name || groupCode) : groupCode;
                        addToUserGroupsList(groupCode, gName);
                        setUserItem('group', groupCode);
                        setUserItem('group_name', gName);
                        CURRENT_GROUP = groupCode;
                        CURRENT_GROUP_NAME = gName;
                        // Remove pending banner if visible
                        const banner = document.getElementById('pending-request-banner');
                        if (banner) banner.remove();
                        triggerConfetti();
                        initApp();
                    });
                }
            }, err => console.log('Approval listener error:', err));
    }
    // Local mode: handled by the 'storage' event listener already set up at the top of the file.
}

function showPendingRequestBanner(groupCode) {
    const wrapper = document.getElementById('dashboard-content-wrapper');
    if (!wrapper) return;
    wrapper.classList.remove('hidden');

    const existing = document.getElementById('pending-request-banner');
    if (existing) existing.remove();

    const dbObj = getLocalDB();
    const groupData = usingFirebase ? null : dbObj.groups[groupCode];
    const groupName = groupData ? groupData.name : groupCode;

    const banner = document.createElement('div');
    banner.id = 'pending-request-banner';
    banner.className = 'bg-orange-50 border border-orange-200 p-3 rounded-xl flex items-center justify-between shadow-sm mb-4';
    banner.innerHTML = `
        <div class="flex items-center gap-2 text-orange-800 text-xs font-semibold">
            <div class="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 shrink-0">
                <i data-lucide="clock" class="w-3.5 h-3.5"></i>
            </div>
            <span>Request to join <strong>${groupName}</strong> is pending admin approval.</span>
        </div>
        <button onclick="cancelPendingRequest('${groupCode}')" class="text-red-500 hover:text-red-700 text-xs font-bold px-2.5 py-1 hover:bg-red-50 rounded transition-colors shrink-0">Cancel</button>
    `;
    wrapper.prepend(banner);
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
    // Note: real-time approval watching is handled by startPendingApprovalWatch()
    // which is called by initApp() right after showPendingRequestBanner().
}

function cancelPendingRequest(groupCode) {
    if (!confirm('Are you sure you want to cancel your join request?')) return;

    if (pendingApprovalListener) {
        pendingApprovalListener();
        pendingApprovalListener = null;
    }

    removeUserItem('pending_request_group');
    removePendingGroup(groupCode);

    const existingBanner = document.getElementById('pending-request-banner');
    if (existingBanner) existingBanner.remove();

    if (usingFirebase && db) {
        const memberId = firebase.auth().currentUser?.uid || CURRENT_USER;
        db.collection('groups').doc(groupCode).collection('joinRequests').doc(memberId).delete().then(() => {
            renderMyGroups();
        }).catch(() => { });
    } else {
        const dbObj = getLocalDB();
        const gd = dbObj.groups[groupCode];
        if (gd && gd.joinRequests) {
            gd.joinRequests = gd.joinRequests.filter(r => r.name !== CURRENT_USER);
            saveLocalDB(dbObj);
        }
        renderMyGroups();
    }
    initApp();
}

// --- DELETE / WIPE GROUP ---
function deleteGroupCompletely() {
    if (!CURRENT_GROUP) { alert('No active group to delete.'); return; }
    const admin = getGroupAdmin();
    const isAdmin = admin && admin.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase();
    if (!isAdmin) { alert('Only the group creator can delete the group.'); return; }

    if (!confirm(`⚠️ This will PERMANENTLY DELETE the group "${CURRENT_GROUP_NAME}" and ALL its data (expenses, members, moments). This cannot be undone.\n\nAre you absolutely sure?`)) return;
    if (!confirm(`Final confirmation: Delete "${CURRENT_GROUP_NAME}"?`)) return;

    if (usingFirebase) {
        const groupRef = db.collection('groups').doc(CURRENT_GROUP);
        // Delete sub-collections then the group doc
        const deleteSubCollection = (subName) =>
            groupRef.collection(subName).get().then(snap =>
                Promise.all(snap.docs.map(d => d.ref.delete()))
            );
        Promise.all([
            deleteSubCollection('members'),
            deleteSubCollection('expenses'),
            deleteSubCollection('moments'),
            deleteSubCollection('joinRequests')
        ]).then(() => groupRef.delete()).then(() => {
            removeFromUserGroupsList(CURRENT_GROUP);
            leaveGroup();
        }).catch(err => alert('Delete failed: ' + err.message));
    } else {
        const dbObj = getLocalDB();
        delete dbObj.groups[CURRENT_GROUP];
        saveLocalDB(dbObj);
        removeFromUserGroupsList(CURRENT_GROUP);
        leaveGroup();
    }
}

function wipeGroupData() {
    if (!CURRENT_GROUP) { alert('No active group.'); return; }
    const admin = getGroupAdmin();
    const isAdmin = admin && admin.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase();
    if (!isAdmin) { alert('Only the group creator can wipe data.'); return; }

    if (!confirm(`This will delete ALL expenses and moments from "${CURRENT_GROUP_NAME}" but KEEP the group and its members.\n\nContinue?`)) return;

    if (usingFirebase) {
        const groupRef = db.collection('groups').doc(CURRENT_GROUP);
        const wipeSubCollection = (subName) =>
            groupRef.collection(subName).get().then(snap =>
                Promise.all(snap.docs.map(d => d.ref.delete()))
            );
        Promise.all([wipeSubCollection('expenses'), wipeSubCollection('moments')])
            .then(() => { alert('\u2705 Group data wiped!'); syncLocalGroupData(); })
            .catch(err => alert('Wipe failed: ' + err.message));
    } else {
        const dbObj = getLocalDB();
        if (dbObj.groups[CURRENT_GROUP]) {
            dbObj.groups[CURRENT_GROUP].expenses = [];
            dbObj.groups[CURRENT_GROUP].moments = [];
            saveLocalDB(dbObj);
            syncLocalGroupData();
            alert('\u2705 Group data wiped!');
        }
    }
}

function leaveGroup() {
    if (CURRENT_GROUP) {
        const groupToLeave = CURRENT_GROUP;
        removeFromUserGroupsList(groupToLeave);

        if (usingFirebase) {
            const currentUser = firebase.auth().currentUser;
            if (currentUser) {
                db.collection("groups").doc(groupToLeave).collection("members").doc(currentUser.uid).delete().catch(e => console.log(e));
            }
        } else {
            const dbObj = getLocalDB();
            const groupData = dbObj.groups[groupToLeave];
            if (groupData && groupData.members) {
                groupData.members = groupData.members.filter(m => m.name !== CURRENT_USER);
                saveLocalDB(dbObj);
            }
        }
    }
    removeUserItem('group');
    removeUserItem('group_name');
    removeUserItem('pending_request_group');
    CURRENT_GROUP = '';
    CURRENT_GROUP_NAME = '';

    // Clean dynamic UI lists
    users = [];
    expenses = [];
    moments = [];
    joinRequests = [];

    // Unsubscribe database listeners
    if (unsubscribeMembers) unsubscribeMembers();
    if (unsubscribeExpenses) unsubscribeExpenses();
    if (unsubscribeMoments) unsubscribeMoments();
    if (unsubscribeJoinRequests) unsubscribeJoinRequests();

    // Re-route home view back to tab dashboard
    switchTab('dashboard');
    initApp();
}

function logout() {
    isSigningIn = false;
    otpVerified = false;

    // Force-hide the profile drawer instantly (no animation delay)
    // The drawer is a fixed overlay outside main-app, so it must be
    // explicitly hidden before the login page is shown.
    const _drawer = document.getElementById('profile-drawer');
    const _drawerContent = document.getElementById('profile-drawer-content');
    if (_drawer) _drawer.classList.add('hidden');
    if (_drawerContent) _drawerContent.classList.add('-translate-x-full');

    if (usingFirebase) {
        firebase.auth().signOut().then(() => {
            // State observer automatically resets UI
            // Clear namespace so next login reads the correct user's data
            localStorage.removeItem('gaytm_active_user_ns');
            localStorage.removeItem('gaytm_user');
        }).catch(err => {
            alert("Logout failed: " + err.message);
        });
    } else {
        // Clear user namespace — critical so next login starts fresh
        localStorage.removeItem('gaytm_active_user_ns');
        localStorage.removeItem('gaytm_user');
        CURRENT_USER = '';
        CURRENT_GROUP = '';
        CURRENT_GROUP_NAME = '';

        // Clean dynamic UI lists
        users = [];
        expenses = [];
        moments = [];

        document.getElementById('main-app').classList.add('hidden');
        document.getElementById('login-view').classList.remove('hidden');

        // Reset input fields
        document.getElementById('login-email').value = '';
        document.getElementById('login-password').value = '';
        document.getElementById('signup-name').value = '';
        document.getElementById('signup-email').value = '';
        document.getElementById('signup-password').value = '';
    }
}

function copyGroupCode() {
    if (!CURRENT_GROUP) return;
    try {
        const tempInput = document.createElement("input");
        tempInput.value = CURRENT_GROUP;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand("copy");
        document.body.removeChild(tempInput);
        alert("Group Code Copied: " + CURRENT_GROUP);
    } catch (err) {
        alert("Failed to copy. Code is: " + CURRENT_GROUP);
    }
}

function initApp() {
    // Language removed
    // Auto-select last joined group if CURRENT_GROUP is empty but user has groups
    if (!CURRENT_GROUP) {
        const myGroups = getUserGroupsList();
        if (myGroups && myGroups.length > 0) {
            const lastGroup = myGroups[myGroups.length - 1];
            CURRENT_GROUP = lastGroup.code;
            CURRENT_GROUP_NAME = lastGroup.name;
            setUserItem('group', CURRENT_GROUP);
            setUserItem('group_name', CURRENT_GROUP_NAME);
        }
    }

    // Clear old banners to prevent duplication
    const existingPending = document.getElementById('pending-request-banner');
    if (existingPending) existingPending.remove();
    const existingNoGroup = document.getElementById('no-group-banner');
    if (existingNoGroup) existingNoGroup.remove();

    document.getElementById('dash-greeting').innerText = `Hey, ${CURRENT_USER}`;
    document.getElementById('profile-name').innerText = CURRENT_USER;
    document.getElementById('hub-greeting').innerText = `Welcome, ${CURRENT_USER}!`;

    // Set profile email
    const emailEl = document.getElementById('profile-email');
    if (emailEl) {
        emailEl.innerText = localStorage.getItem('gaytm_user_email') || 'Demo Session';
    }

    // Sync theme toggle checkbox state
    const isDark = localStorage.getItem('gaytm_theme') === 'dark';
    const toggle = document.getElementById('theme-toggle-checkbox');
    if (toggle) toggle.checked = isDark;

    // Sync Advanced Settings QR toggle state
    const isGroupSpecific = localStorage.getItem('gaytm_group_specific_qr') === 'true';
    const qrToggle = document.getElementById('group-specific-qr-toggle');
    if (qrToggle) qrToggle.checked = isGroupSpecific;

    const botNav = document.getElementById('bottom-nav');
    const dashContentWrapper = document.getElementById('dashboard-content-wrapper');

    if (CURRENT_GROUP) {
        // Ensure the current group is tracked in our user groups list
        addToUserGroupsList(CURRENT_GROUP, CURRENT_GROUP_NAME);

        // Active Group: Show navigation and dashboard
        if (botNav) botNav.classList.remove('hidden');
        if (dashContentWrapper) dashContentWrapper.classList.remove('hidden');

        const groupNameEl = document.getElementById('header-group-name');
        if (groupNameEl) groupNameEl.innerText = CURRENT_GROUP_NAME;
        document.getElementById('header-group-code').innerText = `Code: ${CURRENT_GROUP}`;
        document.getElementById('profile-group-text').innerText = `Group: ${CURRENT_GROUP_NAME} (${CURRENT_GROUP})`;

        populateHeaderGroupSelect();

        initFirebaseInputs();

        if (usingFirebase) {
            startFirebaseSync();
        } else {
            syncLocalGroupData();
        }

        // Ensure we show dashboard
        switchTab('dashboard', false);

        // ── ALSO watch any pending join-request for a DIFFERENT group ──
        // Existing users who already have an active group may still be
        // waiting for approval into a second group.  We must set up the
        // approval listener even when CURRENT_GROUP is already set.
        const pendingReqGroupForExistingUser = getUserItem('pending_request_group');
        if (pendingReqGroupForExistingUser && pendingReqGroupForExistingUser !== CURRENT_GROUP) {
            startPendingApprovalWatch(pendingReqGroupForExistingUser);
        }
    } else {
        // No Group: nav is visible
        if (botNav) botNav.classList.remove('hidden');
        if (dashContentWrapper) dashContentWrapper.classList.remove('hidden');

        const groupNameEl = document.getElementById('header-group-name');
        if (groupNameEl) groupNameEl.innerText = "No Active Group";
        document.getElementById('header-group-code').innerText = "CODE: NONE";
        document.getElementById('profile-group-text').innerText = "Group: None (Join one using the Groups tab)";

        // Clear dynamic UI lists
        users = [];
        expenses = [];
        moments = [];
        joinRequests = [];

        // Check if user has a pending join request
        const pendingReqGroup = getUserItem('pending_request_group');
        if (pendingReqGroup) {
            // Show dashboard with pending-request banner AND start watching for approval
            switchTab('dashboard', false);
            showPendingRequestBanner(pendingReqGroup);
            startPendingApprovalWatch(pendingReqGroup);
        } else {
            // Brand-new user: go to groups setup tab
            switchTab('groups', false);

            // Add a beautiful info card banner suggestion
            const existing = document.getElementById('no-group-banner');
            if (existing) existing.remove();

            const banner = document.createElement('div');
            banner.id = 'no-group-banner';
            banner.className = 'bg-indigo-50 border border-indigo-200 p-4 rounded-xl flex items-center justify-between shadow-sm mb-4 text-left';
            banner.innerHTML = `
                <div class="flex items-start gap-3 text-indigo-900 text-xs">
                    <div class="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                        <i data-lucide="info" class="w-4 h-4"></i>
                    </div>
                    <div>
                        <p class="font-bold">You are not in any group</p>
                        <p class="text-indigo-600 mt-0.5">Start by creating a group or joining one with a code from the Groups tab below.</p>
                    </div>
                </div>
            `;
            const wrapper = document.getElementById('dashboard-content-wrapper');
            if (wrapper) wrapper.prepend(banner);
        }

        renderDashboard();
        renderSplit();
        renderMoments();
        renderPay();
        renderGroupMembers();
        renderJoinRequests();
    }
    // Pre-select current user by default for expenses
    selectedSplitUsers = [CURRENT_USER];
    renderSplitUsers();

    // Render active groups list & current group details info card
    renderMyGroups();
    renderGroupInfo();

    // Refresh Lucide Icons for dynamically rendered controls
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

// --- NAVIGATION LOGIC ---
let isNavigatingBack = false;
function switchTab(tabId, pushHistory = true) {
    const mainContent = document.querySelector('main');
    if (mainContent) {
        mainContent.scrollTop = 0;
    }

    document.querySelectorAll('.view-panel').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('tab-active-animation');
    });
    const panel = document.getElementById(`view-${tabId}`);
    panel.classList.remove('hidden');
    panel.classList.add('tab-active-animation');

    if (tabId === 'groups') {
        renderMyGroups();
        renderGroupInfo();
    }

    if (tabId === 'moments') {
        if (CURRENT_GROUP) {
            localStorage.setItem('gaytm_last_feed_viewed_' + CURRENT_GROUP, Date.now().toString());
        }
        const dot = document.getElementById('feed-notification-dot');
        if (dot) {
            dot.classList.add('hidden');
        }
    }

    document.querySelectorAll('.nav-btn').forEach(btn => {
        const iconBg = btn.querySelector('.icon-bg');
        if (btn.dataset.tab === tabId) {
            if (btn.classList.contains('text-zinc-400')) {
                btn.classList.replace('text-zinc-400', 'text-indigo-600');
            }
            if (iconBg) iconBg.classList.replace('hover:bg-zinc-100', 'bg-indigo-50');
        } else {
            if (btn.classList.contains('text-indigo-600')) {
                btn.classList.replace('text-indigo-600', 'text-zinc-400');
            }
            if (iconBg && iconBg.classList.contains('bg-indigo-50')) {
                iconBg.classList.replace('bg-indigo-50', 'hover:bg-zinc-100');
            }
        }
    });

    // Push browser history so back button works
    if (pushHistory && !isNavigatingBack) {
        history.pushState({ tab: tabId }, '', '');
    }
}

// Browser back button → go to Dashboard
window.addEventListener('popstate', function (e) {
    isNavigatingBack = true;
    if (e.state && e.state.tab) {
        switchTab(e.state.tab, false);
    } else {
        switchTab('dashboard', false);
    }
    isNavigatingBack = false;
});

// --- CORE MATH LOGIC (Privacy Focused) ---
function calculatePersonalBalances() {
    let myTotalSpent = 0;
    let netBalance = 0; // Positive = People owe me. Negative = I owe people.

    expenses.forEach(exp => {
        const isInvolved = exp.paidBy === CURRENT_USER || exp.splitWith.includes(CURRENT_USER);
        if (!isInvolved) return; // Ignore expenses not related to user

        const splitAmount = exp.amount / exp.splitWith.length;

        // Track total value of things I personally consumed
        if (exp.splitWith.includes(CURRENT_USER)) {
            myTotalSpent += splitAmount;
        }

        if (exp.paidBy === CURRENT_USER) {
            // If I paid, I should get back money from everyone else
            const amountOthersOweMe = exp.amount - (exp.splitWith.includes(CURRENT_USER) ? splitAmount : 0);
            netBalance += amountOthersOweMe;
        } else if (exp.splitWith.includes(CURRENT_USER)) {
            // If someone else paid and I'm in the split, I owe them
            netBalance -= splitAmount;
        }
    });

    return { myTotalSpent, netBalance };
}

function renderDashboard() {
    const { myTotalSpent } = calculatePersonalBalances();

    document.getElementById('dash-my-spent').innerText = formatAmt(myTotalSpent);

    // Calculate netting balances first to get correct netted netBalance
    renderSettlementBreakdown();

    let youWillGet = 0;
    let youWillGive = 0;
    const netDebts = calculateNetDebts();
    netDebts.forEach(d => {
        if (d.from.toLowerCase() === CURRENT_USER.toLowerCase()) {
            youWillGive += d.amount;
        } else if (d.to.toLowerCase() === CURRENT_USER.toLowerCase()) {
            youWillGet += d.amount;
        }
    });

    const getEl = document.getElementById('dash-you-will-get');
    const giveEl = document.getElementById('dash-you-will-give');
    if (getEl) getEl.innerText = formatAmt(youWillGet);
    if (giveEl) giveEl.innerText = formatAmt(youWillGive);

    // Show admin danger zone if user is the group creator
    const dangerZone = document.getElementById('admin-danger-zone');
    if (dangerZone) {
        const admin = getGroupAdmin();
        if (admin && admin.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase()) {
            dangerZone.classList.remove('hidden');
        } else {
            dangerZone.classList.add('hidden');
        }
    }


    // Notifications
    const notifs = document.getElementById('dash-notifications');
    if (notifs) {
        if (!CURRENT_GROUP) {
            notifs.innerHTML = `
                <div class="glass-card p-4 text-center text-xs text-zinc-500">
                    Join a group to see notifications.
                </div>
            `;
        } else {
            notifs.innerHTML = `
                <div class="glass-card p-3 flex items-center gap-3">
                    <div class="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-500"><i data-lucide="image" class="w-4 h-4"></i></div>
                    <p class="text-xs text-zinc-700"><span class="font-semibold">System</span> Group dashboard initialized successfully.</p>
                </div>
            `;
        }
    }
    // Refresh Pie Chart
    renderExpensePieChart();
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

function renderSplit() {
    const listEl = document.getElementById('split-expenses-list');
    const emptyEl = document.getElementById('split-empty-state');
    if (!listEl) return;
    listEl.innerHTML = '';

    // Only show expenses involving current user
    const myExpenses = expenses.filter(exp => exp.paidBy === CURRENT_USER || exp.splitWith.includes(CURRENT_USER));

    if (myExpenses.length === 0) {
        listEl.classList.add('hidden');
        emptyEl.classList.remove('hidden');
        emptyEl.classList.add('flex');
    } else {
        listEl.classList.remove('hidden');
        emptyEl.classList.add('hidden');
        emptyEl.classList.remove('flex');

        const globalNetDebts = calculateNetDebts();

        myExpenses.forEach(exp => {
            const isMe = exp.paidBy === CURRENT_USER;
            const splitAmount = exp.amount / exp.splitWith.length;

            let myStatus = "";
            let myStatusColor = "";

            if (isMe) {
                const amountLent = exp.amount - (exp.splitWith.includes(CURRENT_USER) ? splitAmount : 0);
                myStatus = amountLent > 0 ? `Lent ₹${amountLent.toFixed(2)}` : "Covered myself";
                myStatusColor = amountLent > 0
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 px-2.5 py-0.5 rounded-full border border-emerald-200/40 dark:border-emerald-800/30 text-[10px] uppercase tracking-wide font-black"
                    : "bg-zinc-100 text-zinc-650 dark:bg-zinc-800/40 dark:text-zinc-400 px-2.5 py-0.5 rounded-full border border-zinc-200/40 dark:border-zinc-700/30 text-[10px] uppercase tracking-wide font-black";
            } else {
                myStatus = `Borrowed ₹${splitAmount.toFixed(2)}`;
                myStatusColor = "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 px-2.5 py-0.5 rounded-full border border-rose-200/40 dark:border-rose-800/30 text-[10px] uppercase tracking-wide font-black";
            }

            const commentHtml = exp.comment ? `<p class="text-[11px] text-zinc-500 mt-1 italic">"${exp.comment}"</p>` : '';

            // Comments thread on expense card
            let expenseCommentsHtml = '';
            if (exp.comments && exp.comments.length > 0) {
                expenseCommentsHtml = `
                    <div class="mt-2 space-y-1.5 pl-2 border-l-2 border-indigo-500 dark:border-indigo-400">
                        ${exp.comments.map((c, cIdx) => `
                            <div class="text-[10px] text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
                                <span>
                                    <span class="font-bold text-zinc-900 dark:text-zinc-100">${c.user === CURRENT_USER ? 'You' : c.user}:</span> ${c.text}
                                </span>
                                ${c.user === CURRENT_USER ? `
                                    <button onclick="deleteExpenseComment('${exp.id}', ${cIdx})" class="text-red-500 hover:text-red-700 ml-2" title="Delete comment">
                                        <i data-lucide="trash-2" class="w-3 h-3 inline"></i>
                                    </button>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            // Edit split and delete buttons if created by current user
            let editSplitBtn = '';
            if (isMe) {
                editSplitBtn = `
                    <div class="flex items-center gap-3 mt-1.5 flex-wrap">
                        <button onclick="openEditSplitModal('${exp.id}')" class="text-[10px] font-bold text-indigo-600 hover:underline flex items-center gap-1">
                            <i data-lucide="edit-3" class="w-2.5 h-2.5"></i> Edit Split Members
                        </button>
                        <span class="text-zinc-300 dark:text-zinc-700 text-[10px]">|</span>
                        <button onclick="deleteExpense('${exp.id}')" class="text-[10px] font-bold text-red-650 dark:text-red-400 hover:underline flex items-center gap-1">
                            <i data-lucide="trash-2" class="w-2.5 h-2.5"></i> Delete Bill
                        </button>
                    </div>
                `;
            }

            const imageHtml = exp.image ? `
                <div class="mt-2.5 w-full h-48 overflow-hidden rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center relative">
                    <img src="${exp.image}" class="w-full h-full object-contain" />
                </div>
            ` : '';

            const payer = exp.paidBy;
            let splitDetailsHtml = `<div class="mt-2 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg p-2.5 space-y-2 hidden border border-zinc-100 dark:border-zinc-800" id="split-details-${exp.id}">`;

            exp.splitWith.forEach(member => {
                if (member.toLowerCase() === payer.toLowerCase()) {
                    splitDetailsHtml += `
                        <div class="flex justify-between items-center text-[10px]">
                            <span class="font-bold text-zinc-700 dark:text-zinc-300">${member}</span>
                            <span class="text-indigo-600 dark:text-indigo-400 font-black tracking-wide uppercase">Paid</span>
                        </div>
                    `;
                } else {
                    const owesPayer = globalNetDebts.find(d => d.from.toLowerCase() === member.toLowerCase() && d.to.toLowerCase() === payer.toLowerCase());
                    const isCleared = !owesPayer || owesPayer.amount <= 0;
                    const statusText = isCleared ? "Cleared" : "Not Cleared";
                    const statusColor = isCleared ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";

                    splitDetailsHtml += `
                        <div class="flex justify-between items-center text-[10px]">
                            <span class="font-semibold text-zinc-700 dark:text-zinc-300">${member}</span>
                            <span class="${statusColor} font-bold uppercase tracking-wide">${statusText}</span>
                        </div>
                    `;
                }
            });
            splitDetailsHtml += `</div>`;

            listEl.innerHTML += `
                <div class="glass-card p-4 flex flex-col justify-between">
                    <div class="flex items-start gap-3 w-full">
                        <div class="flex-1 text-left">
                            <div class="flex justify-between items-start gap-2">
                                <div class="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                                    <h4 class="font-black text-zinc-950 dark:text-zinc-50 text-base leading-tight">${exp.desc} <span class="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">(Paid by ${isMe ? 'You' : exp.paidBy})</span></h4>
                                    <button onclick="document.getElementById('split-details-${exp.id}').classList.toggle('hidden'); lucide.createIcons();" class="flex items-center justify-center gap-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors text-[9px] text-zinc-600 dark:text-zinc-300 font-bold uppercase px-2 py-1 rounded-md w-fit whitespace-nowrap">
                                        ${exp.splitWith.length} peoples <i data-lucide="chevron-down" class="w-3 h-3"></i>
                                    </button>
                                </div>
                                <div class="flex flex-col items-end gap-1.5 shrink-0">
                                    <p class="font-black text-lg text-zinc-950 dark:text-zinc-50">₹${exp.amount.toFixed(2)}</p>
                                    <span class="${myStatusColor}">${myStatus}</span>
                                </div>
                            </div>
                            ${commentHtml}
                            ${imageHtml}
                            <div class="mt-1 flex flex-col">
                                ${splitDetailsHtml}
                            </div>
                            ${editSplitBtn}
                            ${expenseCommentsHtml}
                            <!-- Inline Expense Comments Form -->
                            <div class="mt-2 flex gap-1.5 border-t border-zinc-100 dark:border-zinc-850 pt-1.5 items-center">
                                <input type="text" id="expense-comment-input-${exp.id}" placeholder="Comment..." class="youtube-comment-input text-[10px] flex-1" style="padding: 4px 0 !important;" onkeydown="if(event.key === 'Enter') { event.preventDefault(); postExpenseComment('${exp.id}'); }" />
                                <button onclick="postExpenseComment('${exp.id}')" class="bg-indigo-600 hover:bg-indigo-700 text-white text-[9px] font-bold px-2 py-1.5 rounded-lg transition-colors active:scale-95">Comment</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
    }
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

// In-memory comments store (keyed by moment id)
const commentsStore = {};
let activeCommentMomentId = null;

function renderMoments() {
    const feed = document.getElementById('moments-feed');
    if (!feed) return;
    feed.innerHTML = '';

    // Remove old grid classes so it functions as a vertical scroll list of cards
    feed.className = "flex flex-col gap-4 p-4";

    if (moments.length === 0) {
        feed.innerHTML = `
            <div class="bg-white dark:bg-zinc-900 p-10 text-center flex flex-col items-center gap-3 text-zinc-400 glass-card">
                <i data-lucide="camera" class="w-10 h-10 opacity-40"></i>
                <p class="font-semibold text-sm">No posts yet.</p>
                <p class="text-xs">Be the first to share a moment!</p>
            </div>
        `;
        if (typeof lucide !== 'undefined') { lucide.createIcons(); }
        return;
    }

    moments.forEach((m, idx) => {
        const momentId = m.id || ('moment_' + idx);
        if (!m.likes) m.likes = [];
        const liked = m.likes.includes(CURRENT_USER);
        const likeCount = m.likes.length;

        if (!m.comments) m.comments = [];

        const userObj = users.find(u => u.name === m.user);
        const avatarSrc = userObj?.avatar || getDefaultAvatar(m.user);
        const isMe = m.user === CURRENT_USER;
        // Comments HTML list
        let commentsHtml = '';
        if (m.comments.length > 0) {
            commentsHtml = `
                <div class="mt-2.5 space-y-1.5 border-t border-zinc-100 dark:border-zinc-800/50 pt-2.5 text-left">
                    ${m.comments.map((c, cIdx) => `
                        <div class="text-xs text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
                            <span>
                                <span class="font-bold mr-1 text-zinc-900 dark:text-zinc-100">${c.user === CURRENT_USER ? 'You' : c.user}:</span>
                                <span>${c.text}</span>
                            </span>
                            ${c.user === CURRENT_USER ? `
                                <button onclick="deleteFeedComment('${momentId}', ${cIdx})" class="text-red-500 hover:text-red-700 ml-2" title="Delete comment">
                                    <i data-lucide="trash-2" class="w-3.5 h-3.5 inline"></i>
                                </button>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }

        const card = document.createElement('div');
        card.className = 'moment-card glass-card overflow-hidden relative';
        card.innerHTML = `
            <!-- Card Header -->
            <div class="flex items-center gap-2.5 p-3.5 pb-2 text-left">
                <img src="${avatarSrc}" class="w-8 h-8 rounded-full border border-zinc-200 dark:border-zinc-800 object-cover bg-zinc-100" />
                <div class="flex-1">
                    <span class="font-bold text-zinc-900 dark:text-zinc-100 text-xs">${isMe ? 'You' : m.user}</span>
                    <p class="text-[9px] text-zinc-400 mt-0.5">${m.time || 'Just now'}</p>
                </div>
                ${isMe ? `
                    <button onclick="deleteMoment('${momentId}')" class="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors" title="Delete post">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                ` : ''}
            </div>

            <!-- Caption (at the top, like Facebook) -->
            ${m.caption ? `
                <div class="px-3.5 pb-3 text-left">
                    <p class="text-xs text-zinc-700 dark:text-zinc-350 leading-relaxed">
                        ${m.caption}
                    </p>
                </div>
            ` : ''}

            <!-- Card Image -->
            ${m.image ? `
                <div class="w-full overflow-hidden bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center h-[450px] relative select-none" 
                     onmousedown="startMomentLongPress('${momentId}', event)" 
                     onmouseup="cancelMomentLongPress()" 
                     onmouseleave="cancelMomentLongPress()" 
                     ontouchstart="startMomentLongPress('${momentId}', event)" 
                     ontouchend="cancelMomentLongPress()" 
                     ontouchmove="cancelMomentLongPress()">
                    <img src="${m.image}" class="w-full h-full object-contain pointer-events-none" />
                    
                    <!-- Reactions Overlay -->
                    <div id="reaction-heart-pop-${momentId}" class="heart-pop text-6xl drop-shadow-lg">❤️</div>
                    
                    <!-- Reaction Pills -->
                    <div class="absolute bottom-2 left-2 flex gap-1.5 flex-wrap pointer-events-none">
                        ${renderReactionPills(m.reactions)}
                    </div>
                </div>
            ` : ''}

            <!-- Card Body / Actions -->
            <div class="p-3.5 text-left relative">
                <!-- Emoji Picker Menu (Hidden by default) -->
                <div id="emoji-picker-${momentId}" class="hidden absolute -top-12 left-4 bg-white dark:bg-zinc-800 rounded-full shadow-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 flex gap-3 z-50 emoji-picker-menu">
                    <button onclick="addReaction('${momentId}', '❤️')" class="hover:scale-125 transition-transform text-lg">❤️</button>
                    <button onclick="addReaction('${momentId}', '🔥')" class="hover:scale-125 transition-transform text-lg">🔥</button>
                    <button onclick="addReaction('${momentId}', '😂')" class="hover:scale-125 transition-transform text-lg">😂</button>
                    <button onclick="addReaction('${momentId}', '🍻')" class="hover:scale-125 transition-transform text-lg">🍻</button>
                </div>

                <div class="flex items-center gap-4 mb-2.5">
                    <button onclick="toggleLikeMoment('${momentId}')" class="flex items-center gap-1.5 text-zinc-500 hover:text-red-500 transition-colors active:scale-90">
                        <i data-lucide="heart" class="w-5 h-5 ${liked ? 'fill-red-500 text-red-500' : 'text-zinc-650'}" style="${liked ? 'fill: #ef4444; color: #ef4444;' : ''}"></i>
                        <span class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">${likeCount}</span>
                    </button>
                    <div class="flex items-center gap-1.5 text-zinc-500">
                        <i data-lucide="message-circle" class="w-5 h-5 text-zinc-600"></i>
                        <span class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">${m.comments.length}</span>
                    </div>
                </div>

                <!-- Comments List -->
                ${commentsHtml}

                <!-- Add Comment Form -->
                <div class="mt-2 flex gap-1.5 border-t border-zinc-100 dark:border-zinc-800/50 pt-1.5 items-center">
                    <input type="text" id="feed-comment-input-${momentId}" placeholder="Comment..." class="youtube-comment-input text-[10px] flex-1" style="padding: 4px 0 !important;" onkeydown="if(event.key === 'Enter') { event.preventDefault(); postFeedComment('${momentId}'); }" />
                    <button onclick="postFeedComment('${momentId}')" class="bg-indigo-600 hover:bg-indigo-700 text-white text-[9px] font-bold px-2 py-1.5 rounded-lg transition-colors active:scale-95">Comment</button>
                </div>
            </div>
        `;
        feed.appendChild(card);
    });

    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}


function renderPay() {
    const list = document.getElementById('pay-friends-list');
    if (!list) return;
    list.innerHTML = '';

    const otherFriends = users.filter(u => u.name !== CURRENT_USER);
    if (otherFriends.length === 0) {
        list.innerHTML = `
            <div class="glass-card p-10 text-center w-full col-span-2 flex flex-col items-center gap-3 text-zinc-400">
                <i data-lucide="scan-line" class="w-10 h-10 opacity-40"></i>
                <p class="text-sm">${t('tab_pay_empty')}</p>
            </div>
        `;
        if (typeof lucide !== 'undefined') { lucide.createIcons(); }
        return;
    }

    const netDebts = calculateNetDebts();

    // Separate: people I owe vs people who owe me
    const iOwe = [];
    const theyOweMe = [];

    otherFriends.forEach(u => {
        const debtToFriend = netDebts.find(d =>
            d.from.toLowerCase() === CURRENT_USER.toLowerCase() &&
            d.to.toLowerCase() === u.name.toLowerCase());
        const debtFromFriend = netDebts.find(d =>
            d.from.toLowerCase() === u.name.toLowerCase() &&
            d.to.toLowerCase() === CURRENT_USER.toLowerCase());

        if (debtToFriend) iOwe.push({ user: u, amount: debtToFriend.amount });
        else if (debtFromFriend) theyOweMe.push({ user: u, amount: debtFromFriend.amount });
        // settled: not shown
    });

    let html = '';

    // ─── Section 1: People I owe → Pay button ───
    if (iOwe.length > 0) {
        html += `<div class="col-span-2 mb-2 mt-1">
            <p class="text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center gap-1">
                <i data-lucide="arrow-up-right" class="w-3 h-3"></i> ${t('tab_pay_you_owe')}
            </p></div>`;
        iOwe.forEach(({ user: u, amount }) => {
            html += `
            <div class="glass-card p-4 flex flex-col items-center text-center cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-all active:scale-95" onclick="openQRModal('${u.name}')">
                <img src="${u.avatar || getDefaultAvatar(u.name)}" class="w-12 h-12 rounded-full border-2 border-red-200 shadow-sm mb-2 object-cover bg-zinc-100" />
                <h4 class="font-bold text-zinc-800 dark:text-zinc-200 text-sm mb-1">${u.name}</h4>
                <p class="text-[10px] text-red-600 dark:text-red-400 font-bold mb-3">${t('lbl_you_owe')} ₹${amount.toFixed(2)}</p>
                <button class="pay-btn w-full text-xs font-semibold py-2 rounded-lg transition-colors active:scale-95">${t('btn_pay')} ₹${amount.toFixed(2)}</button>
            </div>`;
        });
    }

    // ─── Section 2: People who owe me → Nudge + Clear Due ───
    if (theyOweMe.length > 0) {
        html += `<div class="col-span-2 mb-2 ${iOwe.length > 0 ? 'mt-5' : 'mt-1'}">
            <p class="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-1">
                <i data-lucide="arrow-down-left" class="w-3 h-3"></i> ${t('tab_pay_owed_to_you')}
            </p></div>`;
        theyOweMe.forEach(({ user: u, amount }) => {
            html += `
            <div class="glass-card p-4 flex flex-col items-center text-center border border-emerald-100 dark:border-emerald-900/30">
                <img src="${u.avatar || getDefaultAvatar(u.name)}" class="w-12 h-12 rounded-full border-2 border-emerald-200 shadow-sm mb-2 object-cover bg-zinc-100" />
                <h4 class="font-bold text-zinc-800 dark:text-zinc-200 text-sm mb-1">${u.name}</h4>
                <p class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold mb-3">${t('lbl_owes_you')} ₹${amount.toFixed(2)}</p>
                <div class="flex gap-1.5 w-full">
                    <button onclick="nudgePerson('${u.name}', ${amount})" class="flex-1 flex items-center justify-center gap-1 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/40 text-amber-600 dark:text-amber-400 text-[10px] font-bold py-2 rounded-lg transition-colors active:scale-95">
                        <i data-lucide="bell" class="w-3 h-3"></i> ${t('btn_nudge')}
                    </button>
                    <button onclick="clearDue('${u.name}', ${amount})" class="flex-1 flex items-center justify-center gap-1 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold py-2 rounded-lg transition-colors active:scale-95">
                        <i data-lucide="check-circle" class="w-3 h-3"></i> ${t('btn_clear_due')}
                    </button>
                </div>
            </div>`;
        });
    }

    // ─── All settled ───
    if (iOwe.length === 0 && theyOweMe.length === 0) {
        html = `
            <div class="glass-card p-10 text-center w-full col-span-2 flex flex-col items-center gap-3">
                <div class="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                    <i data-lucide="check-circle" class="w-8 h-8 text-emerald-500"></i>
                </div>
                <p class="font-bold text-zinc-700 dark:text-zinc-200">All Settled Up!</p>
            </div>`;
    }

    list.innerHTML = html;
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

function nudgePerson(name, amount) {
    const friend = users.find(u => u.name === name);
    const uid = friend ? (friend.uid || '') : '';
    openChatbox(name, uid);

    if (amount !== undefined) {
        const chatInput = document.getElementById('chatbox-input');
        if (chatInput) {
            chatInput.value = `Hey ${name}, gentle reminder for the pending amount of ₹${parseFloat(amount).toFixed(2)}. Please settle it up!`;
            // Optional delay to ensure modal is open before focusing
            setTimeout(() => chatInput.focus(), 100);
        }
    }
}

function clearDue(debtorName, amount) {
    const amt = parseFloat(amount).toFixed(2);
    if (!confirm(`Are you sure you want to clear ₹${amt} owed by ${debtorName}?\n\nThis marks their debt as settled and will delete their settled expenses from the database to save space. This cannot be undone.`)) return;

    if (usingFirebase) {
        const groupRef = db.collection("groups").doc(CURRENT_GROUP);

        // 1. Get all expenses to adjust or delete them
        groupRef.collection("expenses").get().then(snap => {
            const batch = db.batch();
            snap.forEach(doc => {
                const exp = doc.data();
                const paidByLC = (exp.paidBy || '').toLowerCase();
                const debtorLC = debtorName.toLowerCase();
                const currentLC = CURRENT_USER.toLowerCase();

                const isUserPaidDebtor = paidByLC === currentLC && (exp.splitWith || []).some(n => n.toLowerCase() === debtorLC);
                const isDebtorPaidUser = paidByLC === debtorLC && (exp.splitWith || []).some(n => n.toLowerCase() === currentLC);

                if (isUserPaidDebtor) {
                    const cleanSplitWith = (exp.splitWith || []).filter(n => n.toLowerCase() !== debtorLC);
                    if (cleanSplitWith.length === 0 || (cleanSplitWith.length === 1 && cleanSplitWith[0].toLowerCase() === currentLC)) {
                        batch.delete(doc.ref);
                    } else {
                        const share = exp.amount / exp.splitWith.length;
                        batch.update(doc.ref, {
                            splitWith: cleanSplitWith,
                            amount: Math.max(0, exp.amount - share)
                        });
                    }
                } else if (isDebtorPaidUser) {
                    const cleanSplitWith = (exp.splitWith || []).filter(n => n.toLowerCase() !== currentLC);
                    if (cleanSplitWith.length === 0 || (cleanSplitWith.length === 1 && cleanSplitWith[0].toLowerCase() === debtorLC)) {
                        batch.delete(doc.ref);
                    } else {
                        const share = exp.amount / exp.splitWith.length;
                        batch.update(doc.ref, {
                            splitWith: cleanSplitWith,
                            amount: Math.max(0, exp.amount - share)
                        });
                    }
                }
            });

            // 2. Also delete any settlements between these two users to avoid leftover records
            return groupRef.collection("settlements").get().then(settleSnap => {
                settleSnap.forEach(sDoc => {
                    const s = sDoc.data();
                    const fromLC = (s.from || '').toLowerCase();
                    const toLC = (s.to || '').toLowerCase();
                    const debtorLC = debtorName.toLowerCase();
                    const currentLC = CURRENT_USER.toLowerCase();
                    if ((fromLC === debtorLC && toLC === currentLC) || (fromLC === currentLC && toLC === debtorLC)) {
                        batch.delete(sDoc.ref);
                    }
                });
                return batch.commit();
            });
        }).then(() => {
            showPayToast(`✅ Cleared dues from ${debtorName} & cleaned up settled data!`);
        }).catch(err => alert("Failed to clear due: " + err.message));
    } else {
        // Offline local db
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData) {
            const currentLC = CURRENT_USER.toLowerCase();
            const debtorLC = debtorName.toLowerCase();

            groupData.expenses = (groupData.expenses || []).map(exp => {
                const paidByLC = (exp.paidBy || '').toLowerCase();
                const isUserPaidDebtor = paidByLC === currentLC && (exp.splitWith || []).some(n => n.toLowerCase() === debtorLC);
                const isDebtorPaidUser = paidByLC === debtorLC && (exp.splitWith || []).some(n => n.toLowerCase() === currentLC);

                if (isUserPaidDebtor) {
                    const cleanSplitWith = (exp.splitWith || []).filter(n => n.toLowerCase() !== debtorLC);
                    if (cleanSplitWith.length === 0 || (cleanSplitWith.length === 1 && cleanSplitWith[0].toLowerCase() === currentLC)) {
                        return null;
                    } else {
                        const share = exp.amount / exp.splitWith.length;
                        exp.splitWith = cleanSplitWith;
                        exp.amount = Math.max(0, exp.amount - share);
                        return exp;
                    }
                } else if (isDebtorPaidUser) {
                    const cleanSplitWith = (exp.splitWith || []).filter(n => n.toLowerCase() !== currentLC);
                    if (cleanSplitWith.length === 0 || (cleanSplitWith.length === 1 && cleanSplitWith[0].toLowerCase() === debtorLC)) {
                        return null;
                    } else {
                        const share = exp.amount / exp.splitWith.length;
                        exp.splitWith = cleanSplitWith;
                        exp.amount = Math.max(0, exp.amount - share);
                        return exp;
                    }
                }
                return exp;
            }).filter(Boolean);

            // Delete settlements between them
            groupData.settlements = (groupData.settlements || []).filter(s => {
                const fromLC = (s.from || '').toLowerCase();
                const toLC = (s.to || '').toLowerCase();
                return !((fromLC === debtorLC && toLC === currentLC) || (fromLC === currentLC && toLC === debtorLC));
            });

            saveLocalDB(dbObj);
        }
        renderPay();
        renderDashboard();
        showPayToast(`✅ Cleared dues from ${debtorName}!`);
    }
}

function showPayToast(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-28 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-xs font-semibold px-4 py-2.5 rounded-2xl shadow-xl z-[200] flex items-center gap-2';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// --- GROUP MEMBERS & JOIN REQUEST RENDERING ---

let activeRemoveMemberName = null;

document.addEventListener('click', () => {
    if (activeRemoveMemberName) {
        activeRemoveMemberName = null;
        renderGroupMembers();
    }
});

function handleGroupMemberClick(event, name, uid) {
    event.stopPropagation();
    if (activeRemoveMemberName === name) {
        activeRemoveMemberName = null;
    } else {
        activeRemoveMemberName = name;
    }
    renderGroupMembers();
}

function updateChatLastSeen(user) {
    if (!CURRENT_GROUP || !CURRENT_USER || !user) return;
    const key = `gaytm_chat_last_seen_${CURRENT_GROUP}_${CURRENT_USER}`;
    let lastSeen = {};
    try { lastSeen = JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { }
    const now = Date.now();
    lastSeen[user] = now;
    localStorage.setItem(key, JSON.stringify(lastSeen));

    // Sync to Firestore so the OTHER user can detect blue ticks on their sent messages
    if (usingFirebase && typeof db !== 'undefined' && CURRENT_GROUP) {
        try {
            const authUser = firebase.auth().currentUser;
            const memberId = authUser ? authUser.uid : CURRENT_USER;
            const updateData = {};
            updateData[`chatLastRead.${user}`] = now;
            db.collection('groups').doc(CURRENT_GROUP).collection('members').doc(memberId)
                .update(updateData)
                .catch(() => {}); // silent fail — non-critical
        } catch (e) {}
    }
}

function getChatLastSeen(user) {
    if (!CURRENT_GROUP || !CURRENT_USER || !user) return 0;
    const key = `gaytm_chat_last_seen_${CURRENT_GROUP}_${CURRENT_USER}`;
    try {
        const lastSeen = JSON.parse(localStorage.getItem(key)) || {};
        return lastSeen[user] || 0;
    } catch (e) { return 0; }
}

function hasUnreadMessages(user) {
    const lastSeen = getChatLastSeen(user);
    if (!groupChats) return false;
    return groupChats.some(m => m.from === user && m.to === CURRENT_USER && m.timestamp > lastSeen);
}

function renderGroupMembers() {
    const container = document.getElementById('dash-group-members');
    if (!container) return;
    container.innerHTML = '';

    if (users.length === 0) {
        container.innerHTML = `<p class="text-xs text-zinc-400">No members yet.</p>`;
        return;
    }

    users.forEach(u => {
        const isMe = (u.name || '').trim() === (CURRENT_USER || '').trim();

        let clickAction = '';
        if (!isMe) {
            clickAction = `onclick="openChatbox('${(u.name || '').replace(/'/g, "\\'")}', '${u.uid || ''}')"`;
        }

        const cursorStyle = isMe ? '' : 'cursor-pointer';
        const hoverTitle = isMe ? '' : `title="Chat with ${u.name}"`;

        const hasUnread = !isMe && hasUnreadMessages(u.name);
        const unreadDot = hasUnread ? `<span class="absolute top-0 right-0 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white dark:border-zinc-900 z-10 animate-pulse shadow-sm shadow-red-500/50"></span>` : '';

        container.innerHTML += `
            <div class="flex flex-col items-center gap-1 w-14 relative group ${cursorStyle}" ${clickAction} ${hoverTitle}>
                <div class="relative">
                    <img src="${u.avatar || getDefaultAvatar(u.name)}" class="w-10 h-10 rounded-full border-2 ${isMe ? 'border-indigo-400' : 'border-zinc-200'} shadow-sm object-cover bg-zinc-100" />
                    ${unreadDot}
                </div>
                <span class="text-[10px] font-semibold ${isMe ? 'text-indigo-600' : 'text-zinc-600'} truncate w-full text-center">${isMe ? 'You' : u.name}</span>
            </div>
        `;
    });
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
    updateHomeNotificationDot();
}

function removeMember(name, uid) {
    if (!confirm(`Are you sure you want to remove ${name} from this group?`)) return;

    if (usingFirebase) {
        const memberId = uid || name;
        db.collection("groups").doc(CURRENT_GROUP).collection("members").doc(memberId).delete()
            .then(() => {
                alert(`${name} has been removed from the group.`);
            })
            .catch(err => alert("Error removing member: " + err.message));
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData) {
            groupData.members = groupData.members.filter(m => m.name !== name);
            saveLocalDB(dbObj);
            syncLocalGroupData();
            alert(`${name} has been removed from the group.`);
        }
    }
}

function getGroupAdmin() {
    if (groupAdmin) return groupAdmin;
    if (!usingFirebase) {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        return groupData ? groupData.createdBy : null;
    }
    return null;
}

function updateHomeNotificationDot() {
    const dot = document.getElementById('home-notification-dot');
    if (!dot) return;

    let showDot = false;

    // Check for join requests
    const admin = getGroupAdmin();
    const isAdmin = admin && admin.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase();
    if (isAdmin && joinRequests && joinRequests.length > 0) {
        showDot = true;
    }

    // Check for unread chats
    if (!showDot && typeof users !== 'undefined') {
        const hasUnread = users.some(u => u.name !== CURRENT_USER && hasUnreadMessages(u.name));
        if (hasUnread) showDot = true;
    }

    if (showDot) {
        dot.classList.remove('hidden');
    } else {
        dot.classList.add('hidden');
    }
}

function renderJoinRequests() {
    const section = document.getElementById('dash-join-requests');
    const list = document.getElementById('join-requests-list');
    if (!section || !list) return;

    const admin = getGroupAdmin();
    const isAdmin = admin && admin.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase();

    if (!isAdmin || joinRequests.length === 0) {
        section.classList.add('hidden');
        updateHomeNotificationDot();
        return;
    }

    section.classList.remove('hidden');
    const homeDot = document.getElementById('home-notification-dot');
    if (homeDot) homeDot.classList.remove('hidden');
    list.innerHTML = '';

    joinRequests.forEach(req => {
        list.innerHTML += `
            <div class="glass-card p-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <img src="${req.avatar || getDefaultAvatar(req.name)}" class="w-10 h-10 rounded-full border border-zinc-200 shadow-sm" />
                    <div>
                        <p class="font-semibold text-zinc-800 text-sm">${req.name}</p>
                        <p class="text-[10px] text-zinc-400">${t('req_wants_join')}</p>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="approveJoinRequest('${req.name}')"
                        class="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors active:scale-95">
                        <i data-lucide="check" class="w-3.5 h-3.5 inline"></i> ${t('btn_approve')}
                    </button>
                    <button onclick="rejectJoinRequest('${req.name}')"
                        class="bg-red-50 text-red-600 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors active:scale-95">
                        <i data-lucide="x" class="w-3.5 h-3.5 inline"></i> ${t('btn_reject')}
                    </button>
                </div>
            </div>
        `;
    });
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

function approveJoinRequest(name) {
    const req = joinRequests.find(r => r.name === name);
    if (!req) return;

    const newMember = {
        name: req.name,
        upi: req.upi || '',
        upiPhone: req.upiPhone || '',
        avatar: req.avatar
    };
    if (req.qrImage) {
        newMember.qrImage = req.qrImage;
    }

    if (usingFirebase) {
        const groupRef = db.collection("groups").doc(CURRENT_GROUP);
        const memberId = req.uid || req.name;

        if (req.uid) newMember.uid = req.uid;

        groupRef.get().then(gDoc => {
            const memberLimit = gDoc.data().memberLimit || 0;
            return groupRef.collection("members").get().then(membersSnap => {
                if (memberLimit > 0 && membersSnap.size >= memberLimit) {
                    alert("Cannot approve join request. This group has reached its maximum member limit of " + memberLimit + "!");
                    throw new Error("Limit reached");
                }
                return groupRef.collection("members").doc(memberId).set(newMember)
                    .then(() => groupRef.collection("joinRequests").doc(memberId).delete());
            });
        }).catch(err => {
            if (err.message !== "Limit reached") {
                alert("Error approving request: " + err.message);
            }
        });
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData) {
            const memberLimit = groupData.memberLimit || 0;
            if (memberLimit > 0 && groupData.members.length >= memberLimit) {
                alert("Cannot approve join request. This group has reached its maximum member limit of " + memberLimit + "!");
                return;
            }
            groupData.members.push(newMember);
            groupData.joinRequests = groupData.joinRequests.filter(r => r.name !== name);
            saveLocalDB(dbObj);
            // Clear pending flag if it was for this group
            if (getUserItem('pending_request_group') === CURRENT_GROUP) {
                removeUserItem('pending_request_group');
            }
            syncLocalGroupData();
        }
    }
}

function rejectJoinRequest(name) {
    if (usingFirebase) {
        const req = joinRequests.find(r => r.name === name);
        if (!req) return;
        const requestId = req.uid || req.name;
        db.collection("groups").doc(CURRENT_GROUP).collection("joinRequests").doc(requestId).delete()
            .catch(err => alert("Error rejecting request: " + err.message));
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData) {
            groupData.joinRequests = (groupData.joinRequests || []).filter(r => r.name !== name);
            saveLocalDB(dbObj);
            syncLocalGroupData();
        }
    }
}

// --- MULTI-GROUP SWITCHING ---

function switchToGroup(code, name) {
    // Unsubscribe existing listeners
    if (unsubscribeMembers) unsubscribeMembers();
    if (unsubscribeExpenses) unsubscribeExpenses();
    if (unsubscribeMoments) unsubscribeMoments();
    if (unsubscribeJoinRequests) unsubscribeJoinRequests();

    // Clear state
    users = [];
    expenses = [];
    moments = [];
    joinRequests = [];

    // Set new group
    setUserItem('group', code);
    setUserItem('group_name', name);
    CURRENT_GROUP = code;
    CURRENT_GROUP_NAME = name;

    closeModal('groups-modal');
    switchTab('dashboard');
    initApp();
}

function openMyGroupsModal() {
    closeProfileDrawer();
    renderMyGroups();
    openModal('groups-modal');
}

function renderMyGroups() {
    const list = document.getElementById('my-groups-list');
    const tabList = document.getElementById('groups-tab-active-list');

    const groups = getUserGroupsList();
    const pendingGroups = getPendingGroups();

    // Also ensure the current group is in the list
    if (CURRENT_GROUP && !groups.some(g => g.code === CURRENT_GROUP)) {
        addToUserGroupsList(CURRENT_GROUP, CURRENT_GROUP_NAME);
        groups.push({ code: CURRENT_GROUP, name: CURRENT_GROUP_NAME });
    }

    let htmlContent = '';

    if (groups.length === 0 && pendingGroups.length === 0) {
        htmlContent = `
            <div class="text-center py-6 text-zinc-400">
                <i data-lucide="folder-open" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
                <p class="text-sm">You haven't joined any groups yet.</p>
            </div>
        `;
    } else {
        // Active/Joined groups
        groups.forEach(g => {
            const isActive = g.code === CURRENT_GROUP;
            htmlContent += `
                <div class="glass-card p-4 flex items-center justify-between gap-2 ${isActive ? 'border-indigo-300 bg-indigo-50/50' : ''}">
                    <div class="flex items-center gap-3 min-w-0 flex-1">
                        <div class="w-10 h-10 ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-500'} rounded-lg flex items-center justify-center shrink-0">
                            <i data-lucide="${isActive ? 'check-circle' : 'users'}" class="w-5 h-5"></i>
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="font-semibold text-zinc-800 dark:text-zinc-200 text-sm truncate">${g.name}</p>
                            <p class="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-bold tracking-wider">CODE: ${g.code}${isActive ? ' • Active' : ''}</p>
                            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 font-semibold">Created by: ${g.createdBy || 'Unknown'}${g.createdByEmail ? ` (${g.createdByEmail})` : ''}</p>
                        </div>
                    </div>
                    <div class="flex gap-2 shrink-0">
                        ${isActive ? '' : `<button onclick="switchToGroup('${g.code}', '${g.name.replace(/'/g, "\\'")}')" class="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-100 transition-colors active:scale-95">Switch</button>`}
                        <button onclick="leaveAndRemoveGroup('${g.code}')" class="bg-red-50 text-red-600 px-2 py-1.5 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors active:scale-95">
                            <i data-lucide="log-out" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        // Pending groups
        pendingGroups.forEach(g => {
            htmlContent += `
                <div class="glass-card p-4 flex items-center justify-between gap-2 border-orange-200 bg-orange-50/30">
                    <div class="flex items-center gap-3 min-w-0 flex-1">
                        <div class="w-10 h-10 bg-orange-100 text-orange-600 rounded-lg flex items-center justify-center shrink-0">
                            <i data-lucide="clock" class="w-5 h-5"></i>
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="font-semibold text-zinc-800 dark:text-zinc-200 text-sm truncate">${g.name}</p>
                            <p class="text-[10px] text-orange-600 dark:text-orange-500 uppercase font-bold tracking-wider">CODE: ${g.code} • Pending Approval</p>
                            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 font-semibold">Created by: ${g.createdBy || 'Unknown'}${g.createdByEmail ? ` (${g.createdByEmail})` : ''}</p>
                        </div>
                    </div>
                    <div class="flex gap-2 shrink-0">
                        <button onclick="cancelPendingRequest('${g.code}')" class="bg-red-50 text-red-600 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors active:scale-95">Cancel</button>
                    </div>
                </div>
            `;
        });
    }

    if (list) list.innerHTML = htmlContent;
    if (tabList) tabList.innerHTML = htmlContent;

    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

function leaveAndRemoveGroup(code) {
    if (confirm("Are you sure you want to leave this group?")) {
        removeFromUserGroupsList(code);

        if (usingFirebase) {
            const currentUser = firebase.auth().currentUser;
            if (currentUser) {
                db.collection("groups").doc(code).collection("members").doc(currentUser.uid).delete().catch(e => console.log(e));
            }
        } else {
            const dbObj = getLocalDB();
            const groupData = dbObj.groups[code];
            if (groupData && groupData.members) {
                groupData.members = groupData.members.filter(m => m.name !== CURRENT_USER);
                saveLocalDB(dbObj);
            }
        }

        if (code === CURRENT_GROUP) {
            // Leaving the active group
            leaveGroup();
        } else {
            // Re-render the list
            renderMyGroups();
        }
    }
}

// --- MODAL & ACTION LOGIC ---

function openModal(id) {
    if (id === 'firebase-modal') {
        closeProfileDrawer();
    }
    const modal = document.getElementById(id);
    const content = document.getElementById(`${id}-content`);
    modal.classList.remove('hidden');
    setTimeout(() => {
        if (content.classList.contains('translate-y-full')) {
            content.classList.remove('translate-y-full');
        }
        if (content.classList.contains('scale-95')) {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }
    }, 10);
}

function closeModal(id) {
    const modal = document.getElementById(id);
    const content = document.getElementById(`${id}-content`);

    if (content) {
        // Clear any inline transform from drag/swipe immediately so the CSS animation class can take over
        content.style.transform = '';
    }

    if (content.classList.contains('translate-y-full') === false && id !== 'qr-modal' && id !== 'otp-modal') {
        content.classList.add('translate-y-full');
    }
    if (id === 'qr-modal' || id === 'otp-modal') {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }

    setTimeout(() => {
        modal.classList.add('hidden');
        // Clear any inline styles left over from swipe gestures
        content.style.transform = '';
        content.style.transition = '';

        // Reset Forms
        if (id === 'expense-modal') {
            document.getElementById('expense-desc').value = '';
            document.getElementById('expense-amount').value = '';
            document.getElementById('expense-comment').value = '';
            selectedSplitUsers = [CURRENT_USER];
            renderSplitUsers();

            const expImgCameraInput = document.getElementById('expense-camera-input');
            const expImgGalleryInput = document.getElementById('expense-gallery-input');
            if (expImgCameraInput) expImgCameraInput.value = '';
            if (expImgGalleryInput) expImgGalleryInput.value = '';
            const expImgPreview = document.getElementById('expense-image-preview');
            if (expImgPreview) {
                expImgPreview.src = '';
                expImgPreview.classList.add('hidden');
            }
            const expImgPlaceholder = document.getElementById('expense-image-placeholder');
            if (expImgPlaceholder) expImgPlaceholder.classList.remove('hidden');
            const removeExpBtn = document.getElementById('remove-expense-image-btn');
            if (removeExpBtn) removeExpBtn.classList.add('hidden');
            expenseImageBase64 = null;
        } else if (id === 'moment-modal') {
            document.getElementById('moment-caption').value = '';
            const mCam = document.getElementById('moment-camera-input');
            const mGal = document.getElementById('moment-gallery-input');
            if (mCam) mCam.value = '';
            if (mGal) mGal.value = '';
            document.getElementById('image-preview').classList.add('hidden');
            document.getElementById('image-placeholder').classList.remove('hidden');
            const removeMomBtn = document.getElementById('remove-moment-image-btn');
            if (removeMomBtn) removeMomBtn.classList.add('hidden');
            momentImageBase64 = null;
        } else if (id === 'profile-qr-modal') {
            // Reset the QR upload preview but do NOT clear qrImageBase64 here
            // (it is managed by openProfileQRModal when re-opened)
            const previewImg = document.getElementById('qr-preview-img');
            const placeholder = document.getElementById('qr-upload-placeholder');
            const uploadInput = document.getElementById('qr-upload-input');
            if (previewImg) previewImg.classList.add('hidden');
            if (placeholder) placeholder.classList.remove('hidden');
            if (uploadInput) uploadInput.value = '';
        } else if (id === 'profile-edit-modal') {
            const uploadInput = document.getElementById('avatar-upload-input');
            if (uploadInput) uploadInput.value = '';
            uploadedAvatarBase64 = null;
        } else if (id === 'chatbox-modal') {
            isChatboxOpen = false;
            activeChatUser = null;
            activeChatUid = null;
        }
    }, 300);
}

// Advanced Split selection handling
function renderSplitUsers() {
    const container = document.getElementById('split-users-container');
    const countLabel = document.getElementById('split-count-label');
    if (!container) return;
    container.innerHTML = '';

    countLabel.innerText = `${selectedSplitUsers.length} selected`;

    users.forEach(u => {
        const isSel = selectedSplitUsers.includes(u.name);
        const bgClass = isSel ? 'split-user-btn-selected text-white border-transparent' : 'bg-white text-zinc-500 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';
        const label = u.name === CURRENT_USER ? 'Me' : u.name;

        container.innerHTML += `
            <button onclick="toggleUserSplit('${u.name}')" class="px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all flex items-center gap-1.5 ${bgClass}">
                ${label}
                ${isSel ? '<i data-lucide="check" class="w-3 h-3 text-white"></i>' : ''}
            </button>
        `;
    });
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

function toggleUserSplit(name) {
    if (selectedSplitUsers.includes(name)) {
        selectedSplitUsers = selectedSplitUsers.filter(n => n !== name);
    } else {
        selectedSplitUsers.push(name);
    }
    renderSplitUsers();
}

function addExpense() {
    // Guard: kicked/removed user cannot add expenses
    if (!CURRENT_GROUP || !CURRENT_USER) {
        alert('You are not in an active group. You cannot add expenses.');
        closeModal('expense-modal');
        return;
    }
    const isMember = users.some(u => u.name.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase());
    if (!isMember) {
        alert('You are no longer a member of this group and cannot add expenses.');
        closeModal('expense-modal');
        return;
    }

    const desc = document.getElementById('expense-desc').value.trim();
    const amt = parseFloat(document.getElementById('expense-amount').value);
    const comment = document.getElementById('expense-comment').value.trim();
    const categoryEl = document.getElementById('expense-category');
    const category = categoryEl ? categoryEl.value : 'Others';

    if (!desc || isNaN(amt)) {
        alert('Please enter description and a valid amount.');
        return;
    }
    if (selectedSplitUsers.length === 0) {
        alert('Please select at least one person involved.');
        return;
    }

    const newExpense = {
        desc: desc,
        comment: comment,
        amount: amt,
        paidBy: CURRENT_USER,
        splitWith: [...selectedSplitUsers],
        category: category,
        comments: [],
        image: expenseImageBase64 || null
    };

    if (usingFirebase) {
        db.collection("groups").doc(CURRENT_GROUP).collection("expenses").add({
            ...newExpense,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            closeModal('expense-modal');
            triggerConfetti();
        }).catch(err => {
            console.error("Failed to write to Firebase:", err);
            alert("Firebase write failed. Make sure your Firestore rules are set to Test Mode.");
        });
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData) {
            groupData.expenses.unshift({
                id: 'exp_' + Date.now(),
                ...newExpense,
                date: 'Just now'
            });
            saveLocalDB(dbObj);
            syncLocalGroupData();
        }
        closeModal('expense-modal');
        triggerConfetti();
    }
}

// Helper to check and convert HEIC files to JPG using heic2any
function processHEIC(file) {
    return new Promise((resolve) => {
        if (!file) {
            resolve(null);
            return;
        }
        const fileName = file.name ? file.name.toLowerCase() : '';
        const fileType = file.type ? file.type.toLowerCase() : '';
        if (fileName.endsWith('.heic') || fileType === 'image/heic' || fileType === 'image/heif') {
            if (typeof heic2any === 'function') {
                heic2any({
                    blob: file,
                    toType: "image/jpeg",
                    quality: 0.8
                })
                    .then(conversionResult => {
                        const blob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
                        const newName = file.name.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg");
                        const convertedFile = new File([blob], newName, { type: "image/jpeg" });
                        resolve(convertedFile);
                    })
                    .catch(err => {
                        console.error("HEIC conversion failed, using original file:", err);
                        resolve(file);
                    });
            } else {
                console.warn("heic2any library not loaded, using original file");
                resolve(file);
            }
        } else {
            resolve(file);
        }
    });
}

// --- IMAGE COMPRESSION UTILITY ---
// Compresses an image File to a base64 JPEG under maxSizeKB using Canvas.
// Returns a Promise<string> (base64 data URL).
function compressImage(file, maxSizeKB = 800, initialQuality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                // Scale down large images to max 1920px on longest side
                let { width, height } = img;
                const MAX_DIM = 1920;
                if (width > MAX_DIM || height > MAX_DIM) {
                    if (width > height) {
                        height = Math.round(height * MAX_DIM / width);
                        width = MAX_DIM;
                    } else {
                        width = Math.round(width * MAX_DIM / height);
                        height = MAX_DIM;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Iteratively reduce quality until under maxSizeKB
                let quality = initialQuality;
                let result = canvas.toDataURL('image/jpeg', quality);
                while (result.length * 0.75 > maxSizeKB * 1024 && quality > 0.2) {
                    quality -= 0.08;
                    result = canvas.toDataURL('image/jpeg', quality);
                }
                resolve(result);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function previewMomentImage(event) {
    const rawFile = event.target.files[0];
    if (rawFile) {
        processHEIC(rawFile).then(file => {
            const reader = new FileReader();
            reader.onload = function (e) {
                openCropper(e.target.result, function (croppedBase64) {
                    compressBase64Image(croppedBase64).then(compressed => {
                        momentImageBase64 = compressed;
                        const preview = document.getElementById('image-preview');
                        preview.src = momentImageBase64;
                        preview.classList.remove('hidden');
                        document.getElementById('image-placeholder').classList.add('hidden');
                        const removeBtn = document.getElementById('remove-moment-image-btn');
                        if (removeBtn) { removeBtn.classList.remove('hidden'); removeBtn.classList.add('flex'); }
                    });
                });
            }
            reader.readAsDataURL(file);
        });
    }
}

function removeMomentImage() {
    momentImageBase64 = null;
    const preview = document.getElementById('image-preview');
    if (preview) { preview.src = ''; preview.classList.add('hidden'); }
    document.getElementById('image-placeholder').classList.remove('hidden');
    const removeBtn = document.getElementById('remove-moment-image-btn');
    if (removeBtn) { removeBtn.classList.add('hidden'); removeBtn.classList.remove('flex'); }
    const mCam = document.getElementById('moment-camera-input');
    const mGal = document.getElementById('moment-gallery-input');
    if (mCam) mCam.value = '';
    if (mGal) mGal.value = '';
}

function addMoment() {
    // Guard: kicked/removed user cannot post moments
    if (!CURRENT_GROUP || !CURRENT_USER) {
        alert('You are not in an active group. You cannot post moments.');
        closeModal('moment-modal');
        return;
    }
    const isMemberForMoment = users.some(u => u.name.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase());
    if (!isMemberForMoment) {
        alert('You are no longer a member of this group and cannot post moments.');
        closeModal('moment-modal');
        return;
    }

    const caption = document.getElementById('moment-caption').value.trim();
    if (!caption && !momentImageBase64) {
        alert('Write a caption or select an image to post!');
        return;
    }

    const newMoment = {
        user: CURRENT_USER,
        caption: caption,
        image: momentImageBase64 || null
    };

    if (usingFirebase) {
        db.collection("groups").doc(CURRENT_GROUP).collection("moments").add({
            ...newMoment,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            closeModal('moment-modal');
            triggerConfetti();
        }).catch(err => {
            console.error("Failed to write to Firebase:", err);
            alert("Firebase write failed. Make sure your Firestore rules are set to Test Mode.");
        });
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData) {
            groupData.moments.unshift({
                id: 'moment_' + Date.now(),
                ...newMoment,
                time: 'Just now'
            });
            saveLocalDB(dbObj);
            syncLocalGroupData();
            triggerConfetti();
        }
        closeModal('moment-modal');
    }

    // Reset the modal
    momentImageBase64 = '';
    document.getElementById('moment-caption').value = '';
    const preview = document.getElementById('image-preview');
    if (preview) {
        preview.src = '';
        preview.classList.add('hidden');
    }
    const placeholder = document.getElementById('image-placeholder');
    if (placeholder) placeholder.classList.remove('hidden');
    const fileInput = document.getElementById('moment-image');
    if (fileInput) fileInput.value = '';
}

function deleteMoment(momentId) {
    if (!confirm("Are you sure you want to delete this post?")) return;

    if (usingFirebase) {
        db.collection("groups").doc(CURRENT_GROUP).collection("moments").doc(momentId).delete()
            .then(() => {
                alert("Post deleted successfully.");
            })
            .catch(err => {
                console.error("Error deleting post:", err);
                alert("Failed to delete post: " + err.message);
            });
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData && groupData.moments) {
            const initialLength = groupData.moments.length;
            groupData.moments = groupData.moments.filter(m => m.id !== momentId);
            if (groupData.moments.length < initialLength) {
                saveLocalDB(dbObj);
                syncLocalGroupData();
                alert("Post deleted successfully.");
            } else {
                alert("Post not found.");
            }
        }
    }
}

function previewQRUploadImage(event) {
    const rawFile = event.target.files[0];
    if (rawFile) {
        processHEIC(rawFile).then(file => {
            // QR codes are small so compress lightly — 400KB max, high quality to keep QR scannable
            compressImage(file, 400, 0.92).then(compressed => {
                qrImageBase64 = compressed;
                const preview = document.getElementById('qr-preview-img');
                preview.src = qrImageBase64;
                preview.classList.remove('hidden');
                document.getElementById('qr-upload-placeholder').classList.add('hidden');
                const removeBtn = document.getElementById('remove-qr-btn');
                if (removeBtn) removeBtn.classList.remove('hidden');
            }).catch(() => {
                const reader = new FileReader();
                reader.onload = e => { qrImageBase64 = e.target.result; };
                reader.readAsDataURL(file);
            });
        });
    }
}

function clearQRUpload() {
    qrImageBase64 = null;
    const preview = document.getElementById('qr-preview-img');
    const placeholder = document.getElementById('qr-upload-placeholder');
    const uploadInput = document.getElementById('qr-upload-input');
    const removeBtn = document.getElementById('remove-qr-btn');

    if (preview) {
        preview.src = '';
        preview.classList.add('hidden');
    }
    if (placeholder) placeholder.classList.remove('hidden');
    if (uploadInput) uploadInput.value = '';
    if (removeBtn) removeBtn.classList.add('hidden');
}

function openProfileQRModal() {
    closeProfileDrawer();
    const currentUserObj = users.find(u => usingFirebase ? (u.uid === (firebase.auth().currentUser ? firebase.auth().currentUser.uid : '')) : (u.name === CURRENT_USER));

    const upiInput = document.getElementById('edit-upi-id');
    const upiPhoneInput = document.getElementById('edit-upi-phone');
    const previewImg = document.getElementById('qr-preview-img');
    const placeholder = document.getElementById('qr-upload-placeholder');
    const uploadInput = document.getElementById('qr-upload-input');
    const removeBtn = document.getElementById('remove-qr-btn');

    if (uploadInput) uploadInput.value = '';

    // Determine source
    const isGroupSpecific = localStorage.getItem('gaytm_group_specific_qr') === 'true';
    let upiValue = '';
    let upiPhoneValue = '';
    let qrValue = null;

    if (isGroupSpecific) {
        if (currentUserObj) {
            upiValue = currentUserObj.upi || '';
            upiPhoneValue = currentUserObj.upiPhone || '';
            qrValue = currentUserObj.qrImage || null;
        }
    } else {
        upiValue = getUserItem('global_upi') || (currentUserObj ? currentUserObj.upi : '') || '';
        upiPhoneValue = getUserItem('global_upi_phone') || (currentUserObj ? currentUserObj.upiPhone : '') || '';
        qrValue = getUserItem('global_qr') || (currentUserObj ? currentUserObj.qrImage : null) || null;
    }

    if (upiInput) upiInput.value = upiValue;
    if (upiPhoneInput) upiPhoneInput.value = upiPhoneValue;

    if (qrValue) {
        qrImageBase64 = qrValue;
        previewImg.src = qrImageBase64;
        previewImg.classList.remove('hidden');
        placeholder.classList.add('hidden');
        if (removeBtn) removeBtn.classList.remove('hidden');
    } else {
        qrImageBase64 = null;
        previewImg.src = '';
        previewImg.classList.add('hidden');
        placeholder.classList.remove('hidden');
        if (removeBtn) removeBtn.classList.add('hidden');
    }

    openModal('profile-qr-modal');
}

function saveProfilePaymentDetails() {
    const upiInput = document.getElementById('edit-upi-id');
    const upiValue = upiInput ? upiInput.value.trim() : '';
    const upiPhoneInput = document.getElementById('edit-upi-phone');
    const upiPhoneValue = upiPhoneInput ? upiPhoneInput.value.trim() : '';

    if (!upiValue && !upiPhoneValue) {
        alert("Please enter either a UPI ID or a UPI Phone Number!");
        return;
    }

    const isGroupSpecific = localStorage.getItem('gaytm_group_specific_qr') === 'true';
    if (!isGroupSpecific) {
        setUserItem('global_upi', upiValue);
        setUserItem('global_upi_phone', upiPhoneValue);
        if (qrImageBase64) {
            setUserItem('global_qr', qrImageBase64);
        } else {
            removeUserItem('global_qr');
        }
    }

    const displayValue = upiValue || upiPhoneValue || 'Add your UPI';

    if (usingFirebase) {
        const currentUser = firebase.auth().currentUser;
        if (!currentUser) return;
        const memberId = currentUser.uid;

        const updateData = { upi: upiValue, upiPhone: upiPhoneValue };
        if (qrImageBase64) {
            updateData.qrImage = qrImageBase64;
        } else {
            updateData.qrImage = firebase.firestore.FieldValue.delete();
        }

        db.collection("users").doc(memberId).set({
            upi: upiValue,
            upiPhone: upiPhoneValue,
            qrImage: qrImageBase64 || ''
        }, { merge: true }).catch(err => console.warn("Error saving global profile:", err));

        if (CURRENT_GROUP) {
            db.collection("groups").doc(CURRENT_GROUP).collection("members").doc(memberId).update(updateData).then(() => {
                document.getElementById('profile-upi').innerText = displayValue;
                closeModal('profile-qr-modal');
            }).catch(err => {
                alert("Error saving details: " + err.message);
            });
        } else {
            document.getElementById('profile-upi').innerText = displayValue;
            closeModal('profile-qr-modal');
        }
    } else {
        // Offline Local Simulator Mode
        if (CURRENT_GROUP) {
            const dbObj = getLocalDB();
            const groupData = dbObj.groups[CURRENT_GROUP];
            if (groupData) {
                const member = groupData.members.find(m => m.name === CURRENT_USER);
                if (member) {
                    member.upi = upiValue;
                    member.upiPhone = upiPhoneValue;
                    if (qrImageBase64) {
                        member.qrImage = qrImageBase64;
                    } else {
                        delete member.qrImage;
                    }
                    saveLocalDB(dbObj);
                    syncLocalGroupData();
                }
            }
        }
        document.getElementById('profile-upi').innerText = displayValue;
        closeModal('profile-qr-modal');
    }
}

function openQRModal(name) {
    const user = users.find(u => u.name === name);
    if (user) {
        document.getElementById('qr-name').innerText = user.name;
        document.getElementById('qr-upi').innerText = user.upi || 'Not set';

        const qrUpiPhoneEl = document.getElementById('qr-upi-phone');
        if (qrUpiPhoneEl) {
            qrUpiPhoneEl.innerText = user.upiPhone || 'Not set';
        }

        document.getElementById('qr-avatar').src = user.avatar || getDefaultAvatar(user.name);

        const qrImageEl = document.getElementById('qr-modal-image');
        const upiId = user.upi || (user.upiPhone ? `${user.upiPhone}@upi` : '');
        if (user.qrImage) {
            qrImageEl.src = user.qrImage;
            qrImageEl.classList.remove('hidden');
        } else if (upiId) {
            const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(user.name)}&cu=INR`;
            qrImageEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUrl)}`;
            qrImageEl.classList.remove('hidden');
        } else {
            qrImageEl.src = '';
            qrImageEl.classList.add('hidden');
        }

        openModal('qr-modal');
    }
}

function copyQR() {
    const qrImageEl = document.getElementById('qr-modal-image');
    if (!qrImageEl || !qrImageEl.src || qrImageEl.classList.contains('hidden')) {
        alert("No QR code to copy!");
        return;
    }
    const qrUrl = qrImageEl.src;
    if (qrUrl.startsWith('data:image')) {
        fetch(qrUrl)
            .then(res => res.blob())
            .then(blob => {
                navigator.clipboard.write([
                    new ClipboardItem({ [blob.type]: blob })
                ]).then(() => {
                    alert("QR Code Image copied to clipboard!");
                }).catch(err => {
                    navigator.clipboard.writeText(qrUrl).then(() => {
                        alert("QR Code Data URL copied!");
                    });
                });
            }).catch(err => {
                alert("Failed to copy QR: " + err.message);
            });
    } else {
        fetch(qrUrl)
            .then(res => res.blob())
            .then(blob => {
                navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]).then(() => {
                    alert("QR Code Image copied to clipboard!");
                }).catch(err => {
                    navigator.clipboard.writeText(qrUrl).then(() => {
                        alert("QR Code Link copied!");
                    });
                });
            }).catch(err => {
                navigator.clipboard.writeText(qrUrl).then(() => {
                    alert("QR Code Link copied!");
                }).catch(e => {
                    alert("Failed to copy QR Code Link.");
                });
            });
    }
}

function copyUPI() {
    const upiText = document.getElementById('qr-upi').innerText;
    if (!upiText || upiText === 'Not set') {
        alert("No UPI ID set to copy!");
        return;
    }
    try {
        const tempInput = document.createElement("input");
        tempInput.value = upiText;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand("copy");
        document.body.removeChild(tempInput);
        alert("UPI ID Copied!");
    } catch (err) {
        alert("Failed to copy. UPI: " + upiText);
    }
}

function copyUPIPhone() {
    const phoneEl = document.getElementById('qr-upi-phone');
    if (!phoneEl) return;
    const phoneText = phoneEl.innerText;
    if (!phoneText || phoneText === 'Not set') {
        alert("No UPI Phone Number set to copy!");
        return;
    }
    try {
        const tempInput = document.createElement("input");
        tempInput.value = phoneText;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand("copy");
        document.body.removeChild(tempInput);
        alert("UPI Phone Number Copied!");
    } catch (err) {
        alert("Failed to copy: " + phoneText);
    }
}

function triggerConfetti() {
    var duration = 1.5 * 1000;
    var animationEnd = Date.now() + duration;
    var defaults = { startVelocity: 20, spread: 360, ticks: 60, zIndex: 100 };

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    var interval = setInterval(function () {
        var timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) { return clearInterval(interval); }
        var particleCount = 40 * (timeLeft / duration);
        confetti(Object.assign({}, defaults, { particleCount, colors: ['#4f46e5', '#7c3aed', '#a78bfa'], origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
        confetti(Object.assign({}, defaults, { particleCount, colors: ['#4f46e5', '#7c3aed', '#a78bfa'], origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
    }, 250);
}

// --- SESSION ROUTER CHECK ON STARTUP ---
const loadingTexts = [
    "Authenticating...",
    "Fetching split group...",
    "Calculating balances...",
    "Preparing dashboard..."
];

if (usingFirebase) {
    // Show loader initially while auth state resolves
    const loader = document.getElementById('loader-view');
    loader.classList.remove('hidden');
    loader.classList.remove('opacity-0');

    let authResolved = false;

    // Fallback timer: if Firebase silently fails/hangs (e.g. adblocker), force fallback after 8 seconds
    const authFallbackTimer = setTimeout(() => {
        if (!authResolved) {
            console.warn("Firebase Auth timed out. Running in offline fallback mode.");
            firebaseFallbackMode = true;
            usingFirebase = false;
            loader.classList.add('opacity-0');
            setTimeout(() => loader.classList.add('hidden'), 400);

            // Restore user namespace so getUserItem reads the correct user-scoped keys
            const storedEmail = localStorage.getItem('gaytm_user_email');
            if (storedEmail) {
                const userNs = storedEmail.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                localStorage.setItem('gaytm_active_user_ns', userNs);
            }

            // Fallback to offline mode UI
            const storedUser = localStorage.getItem('gaytm_user');
            if (storedUser) {
                CURRENT_USER = storedUser;

                // Restore group from user-scoped storage so they aren't lost
                const storedGroup = getUserItem('group');
                if (storedGroup) {
                    CURRENT_GROUP = storedGroup;
                    CURRENT_GROUP_NAME = getUserItem('group_name') || storedGroup;
                }

                document.getElementById('login-view').classList.add('hidden');
                document.getElementById('main-app').classList.remove('hidden');
                initApp();
            } else {
                document.getElementById('login-view').classList.remove('hidden');
                document.getElementById('main-app').classList.add('hidden');
            }
        }
    }, 8000);

    try {
        firebase.auth().onAuthStateChanged((user) => {
            authResolved = true;
            clearTimeout(authFallbackTimer);

            // If Firebase Auth resolved after the fallback timer already fired,
            // re-enable Firebase mode so the app uses Firestore data correctly.
            if (firebaseFallbackMode && user) {
                firebaseFallbackMode = false;
                usingFirebase = true;
                if (!db) {
                    try { db = firebase.firestore(); } catch(e) { console.error('Firestore re-init failed:', e); }
                }
            }

            const loaderEl = document.getElementById('loader-view');
            try {
                if (user) {
                    // Firebase verified the password — that's sufficient. Skip OTP for returning users.

                    const emailStr = user.email || 'user@example.com';
                    CURRENT_USER = user.displayName || emailStr.split('@')[0];
                    localStorage.setItem('gaytm_user', CURRENT_USER);
                    localStorage.setItem('gaytm_user_email', emailStr);
                    const userNs = emailStr.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                    localStorage.setItem('gaytm_active_user_ns', userNs);

                    document.getElementById('login-view').classList.add('hidden');
                    document.getElementById('main-app').classList.remove('hidden');

                    const storedGroup = getUserItem('group');
                    if (storedGroup) {
                        CURRENT_GROUP = storedGroup;
                        CURRENT_GROUP_NAME = getUserItem('group_name') || storedGroup;
                    }
                    discoverUserGroupsFirebase();
                    initApp();
                } else {
                    CURRENT_USER = '';
                    CURRENT_GROUP = '';
                    CURRENT_GROUP_NAME = '';
                    localStorage.removeItem('gaytm_user');
                    localStorage.removeItem('gaytm_group');
                    localStorage.removeItem('gaytm_group_name');

                    // Clean dynamic UI lists
                    users = [];
                    expenses = [];
                    moments = [];

                    if (unsubscribeMembers) unsubscribeMembers();
                    if (unsubscribeExpenses) unsubscribeExpenses();
                    if (unsubscribeMoments) unsubscribeMoments();

                    // Force-hide the profile drawer (it lives outside main-app)
                    const _d = document.getElementById('profile-drawer');
                    const _dc = document.getElementById('profile-drawer-content');
                    if (_d) _d.classList.add('hidden');
                    if (_dc) _dc.classList.add('-translate-x-full');

                    document.getElementById('main-app').classList.add('hidden');
                    document.getElementById('login-view').classList.remove('hidden');
                }

                // Hide loader after loading has finished
                loaderEl.classList.add('opacity-0');
                setTimeout(() => loaderEl.classList.add('hidden'), 400);
            } catch (innerErr) {
                console.error("Error inside onAuthStateChanged:", innerErr);
                loaderEl.classList.add('opacity-0');
                setTimeout(() => loaderEl.classList.add('hidden'), 400);
                alert("App initialization error: " + innerErr.message + "\nStack: " + innerErr.stack);

                // Fallback UI to prevent blank screen
                document.getElementById('login-view').classList.remove('hidden');
                document.getElementById('main-app').classList.add('hidden');
            }
        });
    } catch (err) {
        authResolved = true;
        clearTimeout(authFallbackTimer);
        console.error("Firebase Auth failed to initialize (possibly blocked by browser):", err);
        usingFirebase = false;
        loader.classList.add('opacity-0');
        setTimeout(() => loader.classList.add('hidden'), 400);

        // Fallback to offline mode UI
        document.getElementById('login-view').classList.remove('hidden');
        document.getElementById('main-app').classList.add('hidden');
        alert("Firebase Auth was blocked by your browser (e.g., Brave Shields or AdBlocker). Running in offline mode.");
    }
} else {
    // Offline Local Mode startup check
    const storedUser = localStorage.getItem('gaytm_user');
    const storedGroup = getUserItem('group');

    // Explicitly hide the loader just in case it was shown by default
    const loaderEl = document.getElementById('loader-view');
    if (loaderEl) {
        loaderEl.classList.add('opacity-0');
        setTimeout(() => loaderEl.classList.add('hidden'), 400);
    }

    if (storedUser) {
        CURRENT_USER = storedUser;
        document.getElementById('login-view').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');

        if (storedGroup) {
            CURRENT_GROUP = storedGroup;
            CURRENT_GROUP_NAME = getUserItem('group_name') || storedGroup;
        }
        initApp();
    } else {
        document.getElementById('login-view').classList.remove('hidden');
        document.getElementById('main-app').classList.add('hidden');
    }
}

// --- PROFILE & SETTINGS FUNCTIONS ---
function changeDisplayName() {
    const newNameInput = document.getElementById('change-name-input');
    if (!newNameInput) return;
    const newName = newNameInput.value.trim();
    if (!newName) {
        alert('Please enter a valid display name.');
        return;
    }

    const oldName = CURRENT_USER;
    if (newName === oldName) {
        alert('Display name is already set to that name.');
        return;
    }

    if (usingFirebase && firebase.auth().currentUser) {
        const user = firebase.auth().currentUser;
        user.updateProfile({
            displayName: newName
        }).then(() => {
            if (CURRENT_GROUP) {
                db.collection('groups').doc(CURRENT_GROUP).collection('members').doc(user.uid).update({
                    name: newName
                }).catch(e => console.log("Failed updating member name in Firestore:", e));
            }
            CURRENT_USER = newName;
            localStorage.setItem('gaytm_user', newName);
            initApp();
            alert('Display name updated successfully!');
            newNameInput.value = '';
        }).catch(err => {
            alert('Failed to update display name: ' + err.message);
        });
    } else {
        // Offline Mode
        const email = localStorage.getItem('gaytm_user_email') || '';
        if (email) {
            const localUsers = JSON.parse(localStorage.getItem('gaytm_local_users') || '{}');
            if (localUsers[email.toLowerCase()]) {
                localUsers[email.toLowerCase()].name = newName;
                localStorage.setItem('gaytm_local_users', JSON.stringify(localUsers));
            }
        }

        if (CURRENT_GROUP) {
            const dbObj = getLocalDB();
            const group = dbObj.groups[CURRENT_GROUP];
            if (group && group.members) {
                const member = group.members.find(m => m.name === oldName);
                if (member) {
                    member.name = newName;
                }
                saveLocalDB(dbObj);
            }
        }

        CURRENT_USER = newName;
        localStorage.setItem('gaytm_user', CURRENT_USER);
        initApp();
        alert('Display name updated successfully!');
        newNameInput.value = '';
    }
}

function toggleDarkTheme(isDark) {
    const isAmoled = localStorage.getItem('gaytm_amoled_ui') === 'true';

    if (isDark) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('gaytm_theme', 'dark');
        const toggle = document.getElementById('theme-toggle-checkbox');
        if (toggle) toggle.checked = true;
        const iconContainer = document.getElementById('theme-icon-container');
        if (iconContainer) {
            iconContainer.className = 'w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-400';
        }
        const icon = document.getElementById('theme-icon');
        if (icon) {
            icon.setAttribute('data-lucide', 'sun');
        }
    } else {
        // Enforce AMOLED exclusivity: if dark mode is turned off, amoled must be turned off too
        if (isAmoled) {
            toggleAmoledUI(false);
        }

        document.documentElement.classList.remove('dark');
        localStorage.setItem('gaytm_theme', 'light');
        const toggle = document.getElementById('theme-toggle-checkbox');
        if (toggle) toggle.checked = false;
        const iconContainer = document.getElementById('theme-icon-container');
        if (iconContainer) {
            iconContainer.className = 'w-10 h-10 bg-zinc-100 rounded-lg flex items-center justify-center text-zinc-650';
        }
        const icon = document.getElementById('theme-icon');
        if (icon) {
            icon.setAttribute('data-lucide', 'moon');
        }
    }
    renderExpensePieChart();
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

// Initialize theme on script run
(function () {
    const savedTheme = localStorage.getItem('gaytm_theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = savedTheme === 'dark' || (!savedTheme && systemPrefersDark);
    toggleDarkTheme(isDark);
})();

function toggleAmoledUI(isAmoled) {
    if (isAmoled) {
        document.documentElement.classList.add('amoled-mode');
        localStorage.setItem('gaytm_amoled_ui', 'true');
        const toggle = document.getElementById('amoled-ui-toggle');
        if (toggle) toggle.checked = true;
        // Automatically enforce dark theme if AMOLED is chosen
        toggleDarkTheme(true);
    } else {
        document.documentElement.classList.remove('amoled-mode');
        localStorage.setItem('gaytm_amoled_ui', 'false');
        const toggle = document.getElementById('amoled-ui-toggle');
        if (toggle) toggle.checked = false;
    }
}

// Initialize AMOLED on script run
(function () {
    const isAmoled = localStorage.getItem('gaytm_amoled_ui') === 'true';
    toggleAmoledUI(isAmoled);
})();




// --- ADDED PREMIUM FEATURES AND CONTROLS ---
function populateHeaderGroupSelect() {
    const btnName = document.getElementById('custom-group-dropdown-selected-name');
    const menu = document.getElementById('custom-group-dropdown-menu');
    if (!btnName || !menu) return;

    if (CURRENT_GROUP) {
        btnName.innerText = CURRENT_GROUP_NAME;
    } else {
        btnName.innerText = "No Groups";
    }

    menu.innerHTML = '';
    const groups = getUserGroupsList();

    if (groups.length === 0) {
        menu.innerHTML = `<div class="px-4 py-2.5 text-xs text-zinc-400 dark:text-zinc-500">No Groups</div>`;
        return;
    }

    groups.forEach(g => {
        const isActive = g.code === CURRENT_GROUP;
        const item = document.createElement('button');
        item.className = `w-full text-left px-4 py-2.5 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center justify-between ${isActive ? 'text-indigo-600 bg-indigo-50/40 dark:text-indigo-400 dark:bg-indigo-950/20' : 'text-zinc-700 dark:text-zinc-300'}`;
        item.innerHTML = `
            <span>${g.name}</span>
            ${isActive ? '<i data-lucide="check" class="w-3.5 h-3.5 text-indigo-500"></i>' : ''}
        `;
        item.onclick = () => {
            handleGroupSelectChange(g.code);
            closeCustomDropdown();
        };
        menu.appendChild(item);
    });
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

function toggleCustomDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('custom-group-dropdown-menu');
    if (!menu) return;

    if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        setTimeout(() => {
            menu.classList.remove('scale-95', 'opacity-0');
            menu.classList.add('scale-100', 'opacity-100');
        }, 10);
    } else {
        closeCustomDropdown();
    }
}

function closeCustomDropdown() {
    const menu = document.getElementById('custom-group-dropdown-menu');
    if (!menu) return;
    menu.classList.remove('scale-100', 'opacity-100');
    menu.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        menu.classList.add('hidden');
    }, 200);
}

// Add global window listener to close custom dropdown when clicking outside
window.addEventListener('click', () => {
    closeCustomDropdown();
    if (typeof closeChartDropdown === 'function') closeChartDropdown();
});

function toggleChartDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('chart-mode-dropdown-menu');
    if (!menu) return;

    if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        setTimeout(() => {
            menu.classList.remove('scale-95', 'opacity-0');
            menu.classList.add('scale-100', 'opacity-100');
        }, 10);
    } else {
        closeChartDropdown();
    }
}

function closeChartDropdown() {
    const menu = document.getElementById('chart-mode-dropdown-menu');
    if (!menu) return;
    menu.classList.remove('scale-100', 'opacity-100');
    menu.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        menu.classList.add('hidden');
    }, 200);
}

function selectChartMode(mode, name) {
    document.getElementById('chart-mode-dropdown-selected-name').textContent = name;
    closeChartDropdown();
    setChartMode(mode);
}


function handleGroupSelectChange(code) {
    if (!code) return;
    const groups = getUserGroupsList();
    const g = groups.find(x => x.code === code);
    if (g) {
        switchToGroup(g.code, g.name);
    }
}

function discoverUserGroupsFirebase() {
    if (!usingFirebase || !db) return;
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) return;

    // Discover groups the user is a member of
    db.collectionGroup('members').where('uid', '==', currentUser.uid).onSnapshot((snapshot) => {
        snapshot.forEach((doc) => {
            const groupDocRef = doc.ref.parent.parent;
            if (groupDocRef) {
                const groupCode = groupDocRef.id;
                groupDocRef.get().then((gDoc) => {
                    if (gDoc.exists) {
                        const gData = gDoc.data();
                        const groupName = gData.name || groupCode;
                        const createdByEmail = gData.createdByEmail || '';
                        const createdBy = gData.createdBy || '';
                        addToUserGroupsList(groupCode, groupName, createdByEmail, createdBy);

                        // Clear pending state if approved
                        removePendingGroup(groupCode);
                        if (getUserItem('pending_request_group') === groupCode) {
                            removeUserItem('pending_request_group');
                            const banner = document.getElementById('pending-request-banner');
                            if (banner) banner.remove();
                        }
                        renderMyGroups();

                        // If user has no active group, auto-select it
                        if (!CURRENT_GROUP) {
                            setUserItem('group', groupCode);
                            setUserItem('group_name', groupName);
                            CURRENT_GROUP = groupCode;
                            CURRENT_GROUP_NAME = groupName;
                            triggerConfetti();
                            initApp();
                        } else {
                            populateHeaderGroupSelect();
                        }
                    }
                });
            }
        });
    }, (error) => {
        console.error("Error discovering user groups:", error);
    });

    // Discover pending join requests
    db.collectionGroup('joinRequests').where('uid', '==', currentUser.uid).onSnapshot((snapshot) => {
        const activePending = [];
        let pendingPromises = [];

        snapshot.forEach((doc) => {
            const groupDocRef = doc.ref.parent.parent;
            if (groupDocRef) {
                const groupCode = groupDocRef.id;
                const p = groupDocRef.get().then(gDoc => {
                    if (gDoc.exists) {
                        const gData = gDoc.data();
                        const groupName = gData.name || groupCode;
                        const createdByEmail = gData.createdByEmail || '';
                        const createdBy = gData.createdBy || '';
                        activePending.push({ code: groupCode, name: groupName, createdByEmail, createdBy });
                    }
                });
                pendingPromises.push(p);
            }
        });

        Promise.all(pendingPromises).then(() => {
            // Sync pending requests locally
            setUserItem('pending_groups', JSON.stringify(activePending));
            renderMyGroups();

            // Clear active pending tracker if none left
            if (activePending.length === 0) {
                removeUserItem('pending_request_group');
            }
        });
    }, (error) => {
        console.error("Error discovering pending requests:", error);
    });
}

let expenseChart = null;

function setChartMode(mode) {
    chartMode = mode;
    const select = document.getElementById('chart-mode-select');
    if (select) select.value = mode;
    renderExpensePieChart();
}

function calculateNetDebts() {
    if (!CURRENT_GROUP || users.length <= 1 || expenses.length === 0) {
        return [];
    }

    const debts = {};
    users.forEach(u1 => {
        debts[u1.name] = {};
        users.forEach(u2 => {
            debts[u1.name][u2.name] = 0;
        });
    });

    expenses.forEach(exp => {
        // Identify the payer — they must be a current active member to create debts
        const payerObj = users.find(u => u.name.toLowerCase() === exp.paidBy.toLowerCase());
        if (!payerObj) return; // Payer was kicked — skip this expense in debt calculations
        const payer = payerObj.name;

        // Use the ORIGINAL splitWith list length as the denominator so that kicking a member
        // does NOT retroactively change what the remaining members owe.
        // The original denominator is always exp.splitWith.length (the full list at time of creation).
        const originalSplitCount = (exp.splitWith || []).length;
        if (originalSplitCount === 0) return;

        const splitAmount = exp.amount / originalSplitCount;

        // Only create debt entries between currently active members.
        // If a split member was kicked, their debt to the payer is simply forgotten
        // (the payer already knows they lent money; the kicked user's balance is wiped).
        const activeSplitMembers = (exp.splitWith || []).filter(memberName => {
            return users.some(u => u.name.toLowerCase() === memberName.toLowerCase());
        }).map(memberName => {
            return users.find(u => u.name.toLowerCase() === memberName.toLowerCase()).name;
        });

        activeSplitMembers.forEach(member => {
            if (member !== payer) {
                debts[member][payer] += splitAmount;
            }
        });
    });

    // Apply settlements — each settlement reduces the debtor's raw debt
    settlements.forEach(s => {
        const fromName = users.find(u => u.name.toLowerCase() === (s.from || '').toLowerCase())?.name;
        const toName = users.find(u => u.name.toLowerCase() === (s.to || '').toLowerCase())?.name;
        if (fromName && toName && fromName !== toName && debts[fromName]?.[toName] !== undefined) {
            debts[fromName][toName] = Math.max(0, debts[fromName][toName] - s.amount);
        }
    });

    const netDebts = [];
    const processed = new Set();

    users.forEach(u1 => {
        users.forEach(u2 => {
            if (u1.name === u2.name) return;
            const pairKey = [u1.name, u2.name].sort().join('::');
            if (processed.has(pairKey)) return;
            processed.add(pairKey);

            const u1OwesU2 = debts[u1.name][u2.name] || 0;
            const u2OwesU1 = debts[u2.name][u1.name] || 0;

            if (u1OwesU2 > u2OwesU1) {
                netDebts.push({ from: u1.name, to: u2.name, amount: u1OwesU2 - u2OwesU1 });
            } else if (u2OwesU1 > u1OwesU2) {
                netDebts.push({ from: u2.name, to: u1.name, amount: u2OwesU1 - u1OwesU2 });
            }
        });
    });

    return netDebts;
}

function renderExpensePieChart() {
    const canvas = document.getElementById('expense-pie-chart');
    const chartCard = document.getElementById('dashboard-pie-chart-card');
    const detailsContainer = document.getElementById('chart-details-container');
    if (!canvas || !chartCard) return;

    if (!CURRENT_GROUP || expenses.length === 0) {
        chartCard.classList.add('hidden');
        return;
    }

    chartCard.classList.remove('hidden');

    // Auto-fallback if the current chart mode has no data
    let hasWhoOwesMeData = false;
    const netDebts = calculateNetDebts();
    const debtsToMe = netDebts.filter(d => d.to === CURRENT_USER);
    if (debtsToMe.length > 0) {
        hasWhoOwesMeData = true;
    }

    let hasCategoryData = false;
    expenses.forEach(exp => {
        if (exp.splitWith && exp.splitWith.includes(CURRENT_USER)) {
            hasCategoryData = true;
        }
    });

    let totalPaid = 0;
    let totalOwed = 0;
    expenses.forEach(exp => {
        if (exp.paidBy === CURRENT_USER) {
            totalPaid += exp.amount;
        }
        if (exp.splitWith && exp.splitWith.includes(CURRENT_USER)) {
            totalOwed += exp.amount / exp.splitWith.length;
        }
    });
    const hasPaidVsOwedData = (totalPaid > 0 || totalOwed > 0);

    let currentModeHasData = false;
    if (chartMode === 'who-owes-me') currentModeHasData = hasWhoOwesMeData;
    else if (chartMode === 'category') currentModeHasData = hasCategoryData;
    else if (chartMode === 'paid-vs-owed') currentModeHasData = hasPaidVsOwedData;

    if (!currentModeHasData) {
        let targetMode = null;
        let targetName = '';
        if (hasWhoOwesMeData) {
            targetMode = 'who-owes-me';
            targetName = 'Who owes me how much';
        } else if (hasPaidVsOwedData) {
            targetMode = 'paid-vs-owed';
            targetName = 'Paid vs Owed Share';
        } else if (hasCategoryData) {
            targetMode = 'category';
            targetName = 'My Spend Categories';
        }

        if (targetMode && targetMode !== chartMode) {
            chartMode = targetMode;
            const btnText = document.getElementById('chart-mode-dropdown-selected-name');
            if (btnText) btnText.textContent = targetName;
        }
    }

    if (detailsContainer) {
        detailsContainer.innerHTML = '';
        detailsContainer.classList.remove('hidden');
    }

    let labels = [];
    let data = [];
    let customTextHtml = '';
    let hasChartData = false;

    if (chartMode === 'category') {
        const categorySums = {};
        expenses.forEach(exp => {
            if (exp.splitWith && exp.splitWith.includes(CURRENT_USER)) {
                const cat = exp.category || 'Others';
                const share = exp.amount / exp.splitWith.length;
                categorySums[cat] = (categorySums[cat] || 0) + share;
            }
        });

        labels = Object.keys(categorySums);
        data = Object.values(categorySums);
        hasChartData = labels.length > 0;

        if (hasChartData && detailsContainer) {
            customTextHtml = `<p class="font-bold mb-1.5 text-zinc-800 dark:text-zinc-200 uppercase text-[9px] tracking-wider">My Spent Share Breakdown:</p>`;
            labels.forEach((label, idx) => {
                customTextHtml += `
                    <div class="flex justify-between items-center py-0.5 border-b border-zinc-100 dark:border-zinc-800/40">
                        <span class="font-medium text-zinc-600 dark:text-zinc-400">${label}</span>
                        <span class="font-bold text-zinc-800 dark:text-zinc-200">₹${data[idx].toFixed(2)}</span>
                    </div>
                `;
            });
        } else if (detailsContainer) {
            customTextHtml = `<p class="text-zinc-500 text-center py-2">No spent shares found for you in this group's bills.</p>`;
        }
    } else if (chartMode === 'paid-vs-owed') {
        let totalPaid = 0;
        let totalOwed = 0;

        expenses.forEach(exp => {
            if (exp.paidBy === CURRENT_USER) {
                totalPaid += exp.amount;
            }
            if (exp.splitWith && exp.splitWith.includes(CURRENT_USER)) {
                totalOwed += exp.amount / exp.splitWith.length;
            }
        });

        labels = ['Paid by Me', 'My Owed Share'];
        data = [totalPaid, totalOwed];
        hasChartData = (totalPaid > 0 || totalOwed > 0);

        if (hasChartData && detailsContainer) {
            customTextHtml = `
                <p class="font-bold mb-1.5 text-zinc-800 dark:text-zinc-200 uppercase text-[9px] tracking-wider">Paid vs Owed Summary:</p>
                <div class="flex justify-between items-center py-0.5 border-b border-zinc-100 dark:border-zinc-800/40">
                    <span class="font-medium text-zinc-600 dark:text-zinc-400">Total Money I Paid</span>
                    <span class="font-bold text-emerald-600 dark:text-emerald-400">₹${totalPaid.toFixed(2)}</span>
                </div>
                <div class="flex justify-between items-center py-0.5">
                    <span class="font-medium text-zinc-600 dark:text-zinc-400">My Share of Expenses</span>
                    <span class="font-bold text-red-600 dark:text-red-400">₹${totalOwed.toFixed(2)}</span>
                </div>
            `;
        } else if (detailsContainer) {
            customTextHtml = `<p class="text-zinc-500 text-center py-2">No transaction data yet.</p>`;
        }
    } else if (chartMode === 'who-owes-me') {
        const netDebts = calculateNetDebts();
        const debtsToMe = netDebts.filter(d => d.to === CURRENT_USER);

        labels = debtsToMe.map(d => d.from);
        data = debtsToMe.map(d => d.amount);
        hasChartData = debtsToMe.length > 0;

        if (hasChartData && detailsContainer) {
            customTextHtml = `<p class="font-bold mb-1.5 text-zinc-800 dark:text-zinc-200 uppercase text-[9px] tracking-wider">Balances to Receive:</p>`;
            debtsToMe.forEach(d => {
                customTextHtml += `
                    <div class="flex justify-between items-center py-0.5 border-b border-zinc-100 dark:border-zinc-800/40">
                        <span class="font-semibold text-zinc-600 dark:text-zinc-400">${d.from}</span>
                        <span class="font-bold text-emerald-600 dark:text-emerald-400">owes you ₹${d.amount.toFixed(2)}</span>
                    </div>
                `;
            });
        } else if (detailsContainer) {
            customTextHtml = `<p class="text-zinc-500 text-center py-2 font-medium">All settled up! Nobody owes you money in this group.</p>`;
        }
    }

    if (detailsContainer) {
        detailsContainer.innerHTML = customTextHtml;
    }

    if (expenseChart) {
        expenseChart.destroy();
    }

    if (!hasChartData) {
        canvas.style.display = 'none';
        return;
    } else {
        canvas.style.display = 'block';
    }

    const colors = [
        '#00baf2', // Cyan
        '#818cf8', // Indigo
        '#f43f5e', // Rose
        '#10b981', // Emerald
        '#fbbf24', // Amber
        '#a78bfa', // Purple
        '#a1a1aa'  // Gray
    ];

    if (typeof Chart !== 'undefined') {
        expenseChart = new Chart(canvas, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.slice(0, labels.length),
                    borderWidth: data.length > 1 ? 1 : 0,
                    borderColor: document.documentElement.classList.contains('dark') ? '#14151f' : '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: document.documentElement.classList.contains('dark') ? '#f3f4f6' : '#27272a',
                            font: {
                                family: 'Inter, sans-serif',
                                size: 10,
                                weight: 'bold'
                            },
                            padding: 8
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return ` ₹${context.raw.toFixed(2)}`;
                            }
                        }
                    }
                }
            }
        });
    }
}

function renderSettlementBreakdown() {
    const cardEl = document.getElementById('dash-settlement-card');
    const listEl = document.getElementById('dash-settlements-list');
    if (!listEl || !cardEl) return { netBalance: 0 };
    listEl.innerHTML = '';

    const netDebts = calculateNetDebts();

    let myNetBalance = 0;
    netDebts.forEach(d => {
        if (d.from === CURRENT_USER) {
            myNetBalance -= d.amount;
        } else if (d.to === CURRENT_USER) {
            myNetBalance += d.amount;
        }
    });

    if (netDebts.length === 0) {
        cardEl.classList.add('hidden');
        return { netBalance: 0 };
    }

    cardEl.classList.remove('hidden');

    netDebts.forEach(d => {
        const isFromMe = d.from === CURRENT_USER;
        const isToMe = d.to === CURRENT_USER;

        let displayClass = "text-zinc-700 dark:text-zinc-300";
        let amountClass = "text-zinc-900 dark:text-zinc-100";

        if (isFromMe) {
            displayClass = "text-red-750 dark:text-red-400 font-semibold";
            amountClass = "text-red-600 dark:text-red-400 font-bold";
        } else if (isToMe) {
            displayClass = "text-emerald-750 dark:text-emerald-400 font-semibold";
            amountClass = "text-emerald-600 dark:text-emerald-400 font-bold";
        }

        const fromLabel = isFromMe ? "You" : d.from;
        const toLabel = isToMe ? "You" : d.to;

        listEl.innerHTML += `
            <div class="flex items-center justify-between p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-100 dark:border-zinc-800/50 text-left">
                <div class="flex items-center gap-2">
                    <div class="w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                        ${d.from[0].toUpperCase()}
                    </div>
                    <span class="text-xs ${displayClass}">${fromLabel} owe ${toLabel}</span>
                </div>
                <span class="text-xs ${amountClass}">₹${d.amount.toFixed(2)}</span>
            </div>
        `;
    });

    return { netBalance: myNetBalance };
}

let editingExpenseId = null;
let editingSplitUsers = [];

function openEditSplitModal(expenseId) {
    editingExpenseId = expenseId;
    const exp = expenses.find(e => e.id === expenseId);
    if (!exp) return;

    editingSplitUsers = [...exp.splitWith];

    renderEditSplitUsers();
    openModal('edit-split-modal');
}

function renderEditSplitUsers() {
    const container = document.getElementById('edit-split-users-container');
    if (!container) return;
    container.innerHTML = '';
    users.forEach(u => {
        const isSel = editingSplitUsers.includes(u.name);
        const bgClass = isSel ? 'split-user-btn-selected text-white border-transparent' : 'bg-white text-zinc-500 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';
        const label = u.name === CURRENT_USER ? 'Me' : u.name;

        container.innerHTML += `
            <button onclick="toggleEditSplitUser('${u.name}')" class="px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all flex items-center gap-1.5 ${bgClass}">
                ${label}
                ${isSel ? '<i data-lucide="check" class="w-3 h-3 text-white"></i>' : ''}
            </button>
        `;
    });
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

function toggleEditSplitUser(name) {
    if (editingSplitUsers.includes(name)) {
        editingSplitUsers = editingSplitUsers.filter(n => n !== name);
    } else {
        editingSplitUsers.push(name);
    }
    renderEditSplitUsers();
}

function saveEditedSplit() {
    if (editingSplitUsers.length === 0) {
        alert("Please select at least one person to split with!");
        return;
    }

    if (usingFirebase) {
        db.collection("groups").doc(CURRENT_GROUP).collection("expenses").doc(editingExpenseId).update({
            splitWith: editingSplitUsers
        }).then(() => {
            closeModal('edit-split-modal');
        }).catch(err => {
            alert("Failed to update split: " + err.message);
        });
    } else {
        const dbObj = getLocalDB();
        const gd = dbObj.groups[CURRENT_GROUP];
        if (gd && gd.expenses) {
            const exp = gd.expenses.find(x => x.id === editingExpenseId);
            if (exp) {
                exp.splitWith = [...editingSplitUsers];
                saveLocalDB(dbObj);
                syncLocalGroupData();
            }
        }
        closeModal('edit-split-modal');
    }
}

function postExpenseComment(expenseId) {
    const input = document.getElementById(`expense-comment-input-${expenseId}`);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const newComment = {
        user: CURRENT_USER,
        text: text,
        timestamp: new Date().toISOString()
    };

    if (usingFirebase) {
        const expRef = db.collection("groups").doc(CURRENT_GROUP).collection("expenses").doc(expenseId);
        expRef.update({
            comments: firebase.firestore.FieldValue.arrayUnion(newComment)
        }).then(() => {
            input.value = '';
        }).catch(err => console.error("Error adding comment: ", err));
    } else {
        const dbObj = getLocalDB();
        const gd = dbObj.groups[CURRENT_GROUP];
        if (gd && gd.expenses) {
            const exp = gd.expenses.find(x => x.id === expenseId);
            if (exp) {
                if (!exp.comments) exp.comments = [];
                exp.comments.push(newComment);
                saveLocalDB(dbObj);
                syncLocalGroupData();
                input.value = '';
            }
        }
    }
}
// --- MOMENT REACTIONS FUN UI ---
let momentLongPressTimer = null;

function handleMomentDoubleTap(momentId) {
    // Show heart pop animation
    const heart = document.getElementById(`reaction-heart-pop-${momentId}`);
    if (heart) {
        heart.classList.remove('animate-heart-pop');
        void heart.offsetWidth; // trigger reflow
        heart.classList.add('animate-heart-pop');
    }
    // Add reaction
    addReaction(momentId, '❤️');
}

function startMomentLongPress(momentId, e) {
    if (e && e.type === 'mousedown' && e.button !== 0) return; // Only left click
    momentLongPressTimer = setTimeout(() => {
        const picker = document.getElementById(`emoji-picker-${momentId}`);
        if (picker) {
            picker.classList.remove('hidden');
        }
    }, 800); // 800ms for long press to prevent accidental trigger during scroll
}

function cancelMomentLongPress() {
    if (momentLongPressTimer) {
        clearTimeout(momentLongPressTimer);
        momentLongPressTimer = null;
    }
}

function addReaction(momentId, emoji) {
    if (!CURRENT_GROUP || !CURRENT_USER) return;

    // Hide picker if open
    const picker = document.getElementById(`emoji-picker-${momentId}`);
    if (picker) picker.classList.add('hidden');

    if (emoji === '❤️') {
        const heart = document.getElementById(`reaction-heart-pop-${momentId}`);
        if (heart) {
            heart.classList.remove('animate-heart-pop');
            void heart.offsetWidth; // trigger reflow
            heart.classList.add('animate-heart-pop');
        }
    }

    if (usingFirebase) {
        const momentRef = db.collection("groups").doc(CURRENT_GROUP).collection("moments").doc(momentId);
        const updateData = {};
        updateData[`reactions.${CURRENT_USER}`] = emoji;
        momentRef.update(updateData).catch(err => {
            console.error("Error adding reaction: ", err);
        });
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData) {
            const m = groupData.moments.find(x => x.id === momentId);
            if (m) {
                if (!m.reactions) m.reactions = {};
                m.reactions[CURRENT_USER] = emoji;
                saveLocalDB(dbObj);
                syncLocalGroupData();
            }
        }
    }
}

function renderReactionPills(reactionsObj) {
    if (!reactionsObj) return '';
    // Count occurrences of each emoji
    const counts = {};
    Object.values(reactionsObj).forEach(emoji => {
        counts[emoji] = (counts[emoji] || 0) + 1;
    });

    return Object.entries(counts).map(([emoji, count]) => {
        return `<div class="reaction-pill bg-white/90 dark:bg-zinc-800/90 backdrop-blur-sm border border-zinc-200/50 dark:border-zinc-700/50 rounded-full px-2 py-0.5 text-[10px] font-bold text-zinc-800 dark:text-zinc-200 shadow-sm flex items-center gap-1">
            <span>${emoji}</span> <span>${count}</span>
        </div>`;
    }).join('');
}

// Global click to close emoji pickers
window.addEventListener('click', (e) => {
    if (!e.target.closest('.moment-card')) {
        document.querySelectorAll('.emoji-picker-menu').forEach(menu => menu.classList.add('hidden'));
    }
});

function toggleLikeMoment(momentId) {
    // Guard: kicked/removed user cannot interact
    if (!CURRENT_GROUP || !CURRENT_USER) return;
    const isMember = users.some(u => u.name.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase());
    if (!isMember) {
        alert('You are no longer a member of this group and cannot like moments.');
        return;
    }

    if (usingFirebase) {
        const momentRef = db.collection("groups").doc(CURRENT_GROUP).collection("moments").doc(momentId);
        momentRef.get().then((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            let likes = data.likes || [];
            if (likes.includes(CURRENT_USER)) {
                likes = likes.filter(u => u !== CURRENT_USER);
            } else {
                likes.push(CURRENT_USER);
            }
            momentRef.update({ likes });
        });
    } else {
        const dbObj = getLocalDB();
        const gd = dbObj.groups[CURRENT_GROUP];
        if (gd && gd.moments) {
            const m = gd.moments.find(x => x.id === momentId);
            if (m) {
                if (!m.likes) m.likes = [];
                if (m.likes.includes(CURRENT_USER)) {
                    m.likes = m.likes.filter(u => u !== CURRENT_USER);
                } else {
                    m.likes.push(CURRENT_USER);
                }
                saveLocalDB(dbObj);
                syncLocalGroupData();
            }
        }
    }
}

function postFeedComment(momentId) {
    const input = document.getElementById(`feed-comment-input-${momentId}`);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    // Guard: kicked/removed user cannot post comments
    if (!CURRENT_GROUP || !CURRENT_USER) {
        alert('You are not in an active group. You cannot comment.');
        return;
    }
    const isMember = users.some(u => u.name.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase());
    if (!isMember) {
        alert('You are no longer a member of this group and cannot post comments.');
        return;
    }

    const newComment = {
        user: CURRENT_USER,
        text: text,
        timestamp: new Date().toISOString()
    };

    if (usingFirebase) {
        const momentRef = db.collection("groups").doc(CURRENT_GROUP).collection("moments").doc(momentId);
        momentRef.update({
            comments: firebase.firestore.FieldValue.arrayUnion(newComment)
        }).then(() => {
            input.value = '';
        }).catch(err => console.error("Error adding comment: ", err));
    } else {
        const dbObj = getLocalDB();
        const gd = dbObj.groups[CURRENT_GROUP];
        if (gd && gd.moments) {
            const m = gd.moments.find(x => x.id === momentId);
            if (m) {
                if (!m.comments) m.comments = [];
                m.comments.push(newComment);
                saveLocalDB(dbObj);
                syncLocalGroupData();
                input.value = '';
            }
        }
    }
}

let uploadedAvatarBase64 = null;

function openProfileEditModal() {
    closeProfileDrawer();
    document.getElementById('edit-display-name-input').value = CURRENT_USER;

    const currentUserObj = users.find(u => usingFirebase ? (u.uid === (firebase.auth().currentUser ? firebase.auth().currentUser.uid : '')) : (u.name === CURRENT_USER));
    const defaultAvatar = getDefaultAvatar(CURRENT_USER);

    const previewImg = document.getElementById('avatar-preview-img');
    if (previewImg) {
        previewImg.src = currentUserObj?.avatar || defaultAvatar;
    }

    uploadedAvatarBase64 = currentUserObj?.avatar || null;
    openModal('profile-edit-modal');
}

function previewAvatarUploadImage(event) {
    const rawFile = event.target.files[0];
    if (rawFile) {
        processHEIC(rawFile).then(file => {
            const reader = new FileReader();
            reader.onload = function (e) {
                openCropper(e.target.result, function (croppedBase64) {
                    uploadedAvatarBase64 = croppedBase64;
                    const preview = document.getElementById('avatar-preview-img');
                    if (preview) preview.src = uploadedAvatarBase64;
                });
            }
            reader.readAsDataURL(file);
        });
    }
}

function saveProfileDetails() {
    const newNameInput = document.getElementById('edit-display-name-input');
    const newName = newNameInput ? newNameInput.value.trim() : '';
    if (!newName) {
        alert('Please enter a valid display name.');
        return;
    }

    const defaultAvatar = getDefaultAvatar(newName);
    const avatarToSave = uploadedAvatarBase64 || defaultAvatar;
    const oldName = CURRENT_USER;

    if (usingFirebase && firebase.auth().currentUser) {
        const user = firebase.auth().currentUser;

        // Optimistic UI Update (Instant)
        CURRENT_USER = newName;
        localStorage.setItem('gaytm_user', newName);
        initApp();
        closeModal('profile-edit-modal');

        // Background Firebase Update
        user.updateProfile({
            displayName: newName
        }).then(() => {
            if (CURRENT_GROUP) {
                db.collection('groups').doc(CURRENT_GROUP).collection('members').doc(user.uid).update({
                    name: newName,
                    avatar: avatarToSave
                }).catch(e => console.log("Failed updating member in Firestore:", e));
            }
        }).catch(err => {
            console.error('Failed to update profile: ' + err.message);
        });
    } else {
        // Offline Mode
        const email = localStorage.getItem('gaytm_user_email') || '';
        if (email) {
            const localUsers = JSON.parse(localStorage.getItem('gaytm_local_users') || '{}');
            if (localUsers[email.toLowerCase()]) {
                localUsers[email.toLowerCase()].name = newName;
                localUsers[email.toLowerCase()].avatar = avatarToSave;
                localStorage.setItem('gaytm_local_users', JSON.stringify(localUsers));
            }
        }

        if (CURRENT_GROUP) {
            const dbObj = getLocalDB();
            const group = dbObj.groups[CURRENT_GROUP];
            if (group && group.members) {
                const member = group.members.find(m => m.name === oldName);
                if (member) {
                    member.name = newName;
                    member.avatar = avatarToSave;
                }
                saveLocalDB(dbObj);
            }
        }

        CURRENT_USER = newName;
        localStorage.setItem('gaytm_user', CURRENT_USER);
        initApp();
        closeModal('profile-edit-modal');
        alert('Profile updated successfully!');
    }
}

function openProfileDrawer() {
    const drawer = document.getElementById('profile-drawer');
    const content = document.getElementById('profile-drawer-content');
    drawer.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('-translate-x-full');
    }, 10);
}

function closeProfileDrawer() {
    const drawer = document.getElementById('profile-drawer');
    const content = document.getElementById('profile-drawer-content');
    content.classList.add('-translate-x-full');
    setTimeout(() => {
        drawer.classList.add('hidden');
    }, 300);
}

function previewExpenseImage(event) {
    const rawFile = event.target.files[0];
    if (rawFile) {
        processHEIC(rawFile).then(file => {
            const reader = new FileReader();
            reader.onload = function (e) {
                openCropper(e.target.result, function (croppedBase64) {
                    compressBase64Image(croppedBase64).then(compressed => {
                        expenseImageBase64 = compressed;
                        updateExpenseImagePreview();
                    }).catch(() => {
                        expenseImageBase64 = croppedBase64;
                        updateExpenseImagePreview();
                    });
                });
            }
            reader.readAsDataURL(file);
        });
    }
}

function updateExpenseImagePreview() {
    const preview = document.getElementById('expense-image-preview');
    if (preview) {
        preview.src = expenseImageBase64;
        preview.classList.remove('hidden');
    }
    const placeholder = document.getElementById('expense-image-placeholder');
    if (placeholder) placeholder.classList.add('hidden');
    const removeBtn = document.getElementById('remove-expense-image-btn');
    if (removeBtn) { removeBtn.classList.remove('hidden'); removeBtn.classList.add('flex'); }
}

function removeExpenseImage() {
    expenseImageBase64 = null;
    const preview = document.getElementById('expense-image-preview');
    if (preview) { preview.src = ''; preview.classList.add('hidden'); }
    const placeholder = document.getElementById('expense-image-placeholder');
    if (placeholder) placeholder.classList.remove('hidden');
    const removeBtn = document.getElementById('remove-expense-image-btn');
    if (removeBtn) { removeBtn.classList.add('hidden'); removeBtn.classList.remove('flex'); }
    const eCam = document.getElementById('expense-camera-input');
    const eGal = document.getElementById('expense-gallery-input');
    if (eCam) eCam.value = '';
    if (eGal) eGal.value = '';
}

function deleteExpenseComment(expenseId, commentIdx) {
    if (!confirm("Are you sure you want to delete your comment?")) return;

    if (usingFirebase) {
        const expRef = db.collection("groups").doc(CURRENT_GROUP).collection("expenses").doc(expenseId);
        expRef.get().then((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            const comments = data.comments || [];
            if (comments[commentIdx] && comments[commentIdx].user === CURRENT_USER) {
                comments.splice(commentIdx, 1);
                expRef.update({ comments });
            }
        });
    } else {
        const dbObj = getLocalDB();
        const gd = dbObj.groups[CURRENT_GROUP];
        if (gd && gd.expenses) {
            const exp = gd.expenses.find(x => x.id === expenseId);
            if (exp && exp.comments) {
                if (exp.comments[commentIdx] && exp.comments[commentIdx].user === CURRENT_USER) {
                    exp.comments.splice(commentIdx, 1);
                    saveLocalDB(dbObj);
                    syncLocalGroupData();
                }
            }
        }
    }
}

function deleteExpense(expenseId) {
    if (!confirm("Are you sure you want to delete this bill? This will recalculate everyone's balances.")) return;

    if (usingFirebase) {
        db.collection("groups").doc(CURRENT_GROUP).collection("expenses").doc(expenseId).delete()
            .then(() => {
                // Success, Firestore listener will auto-update
            })
            .catch(err => {
                alert("Failed to delete bill: " + err.message);
            });
    } else {
        const dbObj = getLocalDB();
        const gd = dbObj.groups[CURRENT_GROUP];
        if (gd && gd.expenses) {
            gd.expenses = gd.expenses.filter(x => x.id !== expenseId);
            saveLocalDB(dbObj);
            syncLocalGroupData();
        }
    }
}

function deleteFeedComment(momentId, commentIdx) {
    if (!confirm("Are you sure you want to delete your comment?")) return;

    if (usingFirebase) {
        const momentRef = db.collection("groups").doc(CURRENT_GROUP).collection("moments").doc(momentId);
        momentRef.get().then((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            const comments = data.comments || [];
            if (comments[commentIdx] && comments[commentIdx].user === CURRENT_USER) {
                comments.splice(commentIdx, 1);
                momentRef.update({ comments });
            }
        });
    } else {
        const dbObj = getLocalDB();
        const gd = dbObj.groups[CURRENT_GROUP];
        if (gd && gd.moments) {
            const m = gd.moments.find(x => x.id === momentId);
            if (m && m.comments) {
                if (m.comments[commentIdx] && m.comments[commentIdx].user === CURRENT_USER) {
                    m.comments.splice(commentIdx, 1);
                    saveLocalDB(dbObj);
                    syncLocalGroupData();
                }
            }
        }
    }
}

// --- GROUP INFORMATION & DETAILS CARD ---
function renderGroupInfo() {
    const infoCard = document.getElementById('groups-info-card');
    if (!infoCard) return;

    if (!CURRENT_GROUP) {
        infoCard.classList.add('hidden');
        return;
    }

    infoCard.classList.remove('hidden');
    document.getElementById('groups-active-name').innerText = CURRENT_GROUP_NAME;
    document.getElementById('groups-active-code').innerText = CURRENT_GROUP;

    const defaultAvatar = getDefaultAvatar(CURRENT_GROUP_NAME);
    const avatarImg = document.getElementById('groups-avatar-img');
    const aboutText = document.getElementById('groups-about-text');
    const creatorEl = document.getElementById('groups-active-creator');

    const limitDiv = document.getElementById('groups-limit-div');
    const limitDisplayDiv = document.getElementById('groups-limit-display-div');
    const limitInput = document.getElementById('groups-limit-input');
    const limitValue = document.getElementById('groups-limit-value');

    const admin = getGroupAdmin();
    const isLeader = admin && admin.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase();

    if (usingFirebase) {
        db.collection("groups").doc(CURRENT_GROUP).get().then((doc) => {
            if (doc.exists) {
                const data = doc.data();
                if (avatarImg) avatarImg.src = data.avatar || defaultAvatar;
                if (aboutText) aboutText.innerText = data.about || "";

                // Show Group Creator Details
                const creatorName = data.createdBy || 'Unknown';
                const creatorEmail = data.createdByEmail || '';
                if (creatorEl) {
                    creatorEl.innerText = creatorEmail ? `Created by: ${creatorName} (${creatorEmail})` : `Created by: ${creatorName}`;
                }
                updateLocalUserGroupCreator(CURRENT_GROUP, creatorEmail, creatorName);

                // Populate member limit
                const limit = data.memberLimit || 0;
                if (limitInput) limitInput.value = limit > 0 ? limit : '';
                if (limitValue) limitValue.innerText = limit > 0 ? limit : 'Unlimited';

                if (isLeader) {
                    if (limitDiv) limitDiv.classList.remove('hidden');
                    if (limitDisplayDiv) limitDisplayDiv.classList.add('hidden');
                } else {
                    if (limitDiv) limitDiv.classList.add('hidden');
                    if (limitDisplayDiv) limitDisplayDiv.classList.remove('hidden');
                }
            }
        }).catch(() => {
            if (avatarImg) avatarImg.src = defaultAvatar;
        });
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData) {
            if (avatarImg) avatarImg.src = groupData.avatar || defaultAvatar;
            if (aboutText) aboutText.innerText = groupData.about || "";

            // Show Group Creator Details
            const creatorName = groupData.createdBy || 'Unknown';
            const creatorEmail = groupData.createdByEmail || '';
            if (creatorEl) {
                creatorEl.innerText = creatorEmail ? `Created by: ${creatorName} (${creatorEmail})` : `Created by: ${creatorName}`;
            }
            updateLocalUserGroupCreator(CURRENT_GROUP, creatorEmail, creatorName);

            const limit = groupData.memberLimit || 0;
            if (limitInput) limitInput.value = limit > 0 ? limit : '';
            if (limitValue) limitValue.innerText = limit > 0 ? limit : 'Unlimited';

            if (isLeader) {
                if (limitDiv) limitDiv.classList.remove('hidden');
                if (limitDisplayDiv) limitDisplayDiv.classList.add('hidden');
            } else {
                if (limitDiv) limitDiv.classList.add('hidden');
                if (limitDisplayDiv) limitDisplayDiv.classList.remove('green-600');
            }
        } else {
            if (avatarImg) avatarImg.src = defaultAvatar;
        }
    }
}

function openGroupAvatarInput() {
    const input = document.getElementById('group-avatar-upload');
    if (input) input.click();
}

function uploadGroupAvatar(event) {
    const rawFile = event.target.files[0];
    if (!rawFile || !CURRENT_GROUP) return;

    processHEIC(rawFile).then(file => {
        const reader = new FileReader();
        reader.onload = function (e) {
            openCropper(e.target.result, function (croppedBase64) {
                compressBase64Image(croppedBase64).then(compressed => {
                    const avatarImg = document.getElementById('groups-avatar-img');
                    if (avatarImg) avatarImg.src = compressed;

                    if (usingFirebase) {
                        db.collection("groups").doc(CURRENT_GROUP).update({
                            avatar: compressed
                        }).then(() => {
                            alert("Group photo updated!");
                        }).catch(err => {
                            alert("Failed to update group photo: " + err.message);
                        });
                    } else {
                        const dbObj = getLocalDB();
                        if (dbObj.groups[CURRENT_GROUP]) {
                            dbObj.groups[CURRENT_GROUP].avatar = compressed;
                            saveLocalDB(dbObj);
                            alert("Group photo updated!");
                        }
                    }
                });
            });
        };
        reader.readAsDataURL(file);
    });
}

function toggleEditGroupAbout() {
    const editDiv = document.getElementById('groups-about-edit-div');
    const aboutText = document.getElementById('groups-about-text');
    const editBtn = document.getElementById('groups-edit-about-btn');
    const textarea = document.getElementById('groups-about-textarea');

    if (editDiv.classList.contains('hidden')) {
        editDiv.classList.remove('hidden');
        aboutText.classList.add('hidden');
        editBtn.classList.add('hidden');
        textarea.value = aboutText.innerText;
    } else {
        editDiv.classList.add('hidden');
        aboutText.classList.remove('hidden');
        editBtn.classList.remove('hidden');
    }
}

function saveGroupAbout() {
    const textarea = document.getElementById('groups-about-textarea');
    if (!textarea || !CURRENT_GROUP) return;
    const aboutVal = textarea.value.trim();

    if (usingFirebase) {
        db.collection("groups").doc(CURRENT_GROUP).update({
            about: aboutVal
        }).then(() => {
            document.getElementById('groups-about-text').innerText = aboutVal;
            toggleEditGroupAbout();
        }).catch(err => {
            alert("Failed to update about section: " + err.message);
        });
    } else {
        const dbObj = getLocalDB();
        if (dbObj.groups[CURRENT_GROUP]) {
            dbObj.groups[CURRENT_GROUP].about = aboutVal;
            saveLocalDB(dbObj);
            document.getElementById('groups-about-text').innerText = aboutVal;
            toggleEditGroupAbout();
        }
    }
}

// Manual data sync/reload helper to avoid full browser refreshes
function handleReload(event) {
    if (event && event.currentTarget) {
        const btn = event.currentTarget;
        const icon = btn.querySelector('i');
        if (icon) {
            icon.classList.add('animate-spin');
            setTimeout(() => {
                icon.classList.remove('animate-spin');
            }, 1000);
        }
    }

    if (usingFirebase) {
        discoverUserGroupsFirebase();
        initApp();
    } else {
        syncLocalGroupData();
        initApp();
    }
}

function saveGroupLimit() {
    const limitInput = document.getElementById('groups-limit-input');
    if (!limitInput || !CURRENT_GROUP) return;
    const limitVal = parseInt(limitInput.value) || 0;

    if (usingFirebase) {
        db.collection("groups").doc(CURRENT_GROUP).update({
            memberLimit: limitVal
        }).then(() => {
            alert("Member limit updated successfully!");
            initApp();
        }).catch(err => alert("Failed to update member limit: " + err.message));
    } else {
        const dbObj = getLocalDB();
        if (dbObj.groups[CURRENT_GROUP]) {
            dbObj.groups[CURRENT_GROUP].memberLimit = limitVal;
            saveLocalDB(dbObj);
            alert("Member limit updated successfully!");
            initApp();
        }
    }
}

function toggleGroupSpecificQR(checked) {
    localStorage.setItem('gaytm_group_specific_qr', checked ? 'true' : 'false');
    // Force refresh the active QR view
    const modal = document.getElementById('profile-qr-modal');
    if (modal && !modal.classList.contains('hidden')) {
        openProfileQRModal();
    }
}

// Swipe Down to Dismiss/Minimize Modals
function makeModalSwipable(modalId, contentId) {
    const modal = document.getElementById(modalId);
    const content = document.getElementById(contentId);
    if (!modal || !content) return;

    let touchStart = 0;
    let currentY = 0;
    let isDragging = false;

    // Check if touch target is scrolled down (so we don't interfere with inner scrolling)
    function isAtScrollTop(e) {
        const scrollable = e.target.closest('.overflow-y-auto, .overflow-y-scroll, [class*="overflow-y"]');
        if (scrollable) {
            return scrollable.scrollTop <= 0;
        }
        return content.scrollTop <= 0;
    }

    // Touch Events
    content.addEventListener('touchstart', e => {
        if (isAtScrollTop(e)) {
            touchStart = e.touches[0].clientY;
            content.style.transition = 'none';
        } else {
            touchStart = 0;
        }
    }, { passive: true });

    content.addEventListener('touchmove', e => {
        if (touchStart === 0) return;
        currentY = e.touches[0].clientY;
        const diff = currentY - touchStart;
        if (diff > 0) {
            content.style.transform = `translateY(${diff}px)`;
        }
    }, { passive: true });

    content.addEventListener('touchend', e => {
        if (touchStart === 0) return;
        const diff = currentY - touchStart;
        content.style.transition = 'transform 0.3s ease-out';
        if (diff > 120) {
            closeModal(modalId);
        } else {
            content.style.transform = 'translateY(0)';
        }
        touchStart = 0;
        currentY = 0;
    });

    // Mouse drag events for webapp
    content.addEventListener('mousedown', e => {
        if (isAtScrollTop(e)) {
            isDragging = true;
            touchStart = e.clientY;
            content.style.transition = 'none';
            content.style.userSelect = 'none';
        }
    });

    window.addEventListener('mousemove', e => {
        if (!isDragging) return;
        currentY = e.clientY;
        const diff = currentY - touchStart;
        if (diff > 0) {
            content.style.transform = `translateY(${diff}px)`;
        }
    });

    window.addEventListener('mouseup', e => {
        if (!isDragging) return;
        isDragging = false;
        const diff = currentY - touchStart;
        content.style.transition = 'transform 0.3s ease-out';
        content.style.userSelect = '';
        if (diff > 120) {
            closeModal(modalId);
        } else {
            content.style.transform = 'translateY(0)';
        }
        touchStart = 0;
        currentY = 0;
    });
}

// Enable Modal Swiping on Load
setTimeout(() => {
    makeModalSwipable('expense-modal', 'expense-modal-content');
    makeModalSwipable('moment-modal', 'moment-modal-content');
    makeModalSwipable('chat-msg-options-modal', 'chat-msg-options-modal-content');
    makeModalSwipable('profile-qr-modal', 'profile-qr-modal-content');
    makeModalSwipable('groups-modal', 'groups-modal-content');
    makeModalSwipable('profile-edit-modal', 'profile-edit-modal-content');
    makeModalSwipable('chatbox-modal', 'chatbox-modal-content');
}, 1000);

// --- MOBILE PULL TO REFRESH TOUCH GESTURES ---
let ptrTouchStart = 0;
let ptrPullOffset = 0;
const ptrThreshold = 100;

document.addEventListener('touchstart', e => {
    const isModal = e.target.closest('#expense-modal') ||
        e.target.closest('#groups-modal') ||
        e.target.closest('#profile-drawer') ||
        e.target.closest('#moment-modal') ||
        e.target.closest('#qr-modal') ||
        e.target.closest('#firebase-modal') ||
        e.target.closest('#otp-modal') ||
        e.target.closest('#profile-qr-modal') ||
        e.target.closest('#edit-split-modal') ||
        e.target.closest('#profile-edit-modal') ||
        e.target.closest('#reset-password-modal') ||
        e.target.closest('#crop-modal') ||
        e.target.closest('#chatbox-modal');

    const mainArea = document.querySelector('main');
    if (!isModal && mainArea && mainArea.scrollTop === 0) {
        ptrTouchStart = e.touches[0].clientY;
    } else {
        ptrTouchStart = 0;
    }
}, { passive: true });

document.addEventListener('touchmove', e => {
    if (ptrTouchStart === 0) return;
    const currentY = e.touches[0].clientY;
    ptrPullOffset = currentY - ptrTouchStart;

    if (ptrPullOffset > 0) {
        const indicator = document.getElementById('pull-refresh-indicator');
        const arrow = document.getElementById('pull-refresh-arrow');
        if (indicator) {
            const translateY = Math.min(ptrPullOffset * 0.4 - 50, 20); // max 20px down
            indicator.style.transform = `translateY(${translateY}px)`;

            if (arrow) {
                const rotation = Math.min(ptrPullOffset * 2, 180);
                arrow.style.transform = `rotate(${rotation}deg)`;
            }
        }
    }
}, { passive: true });

document.addEventListener('touchend', () => {
    if (ptrTouchStart === 0) return;

    const indicator = document.getElementById('pull-refresh-indicator');
    const arrow = document.getElementById('pull-refresh-arrow');
    const spinner = document.getElementById('pull-refresh-spinner');

    if (ptrPullOffset >= ptrThreshold) {
        if (arrow) arrow.classList.add('hidden');
        if (spinner) spinner.classList.remove('hidden');

        if (indicator) {
            indicator.style.transform = `translateY(20px)`;
        }

        // Actually refresh the mobile browser window!
        setTimeout(() => {
            window.location.reload();
        }, 300);
    } else {
        if (indicator) indicator.style.transform = `translateY(-100%)`;
        setTimeout(() => {
            if (arrow) arrow.style.transform = `rotate(0deg)`;
        }, 250);
    }

    ptrTouchStart = 0;
    ptrPullOffset = 0;
});

function toggleAdvancedSettingsDropdown() {
    const content = document.getElementById('advanced-settings-dropdown-content');
    const chevron = document.getElementById('advanced-settings-chevron');
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        if (chevron) chevron.classList.add('rotate-180');
    } else {
        content.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
    }
}

function copyCreateGroupCode() {
    const code = document.getElementById('create-group-code').value.trim();
    if (!code) {
        alert("Please enter or generate a code first!");
        return;
    }
    navigator.clipboard.writeText(code.toUpperCase()).then(() => {
        alert("Group code copied: " + code.toUpperCase());
    }).catch(() => {
        alert("Failed to copy automatically. Code is: " + code.toUpperCase());
    });
}

function generateUniqueGroupCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const generateRandomCode = () => {
        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    };

    const attemptGenerate = (attempts = 0) => {
        if (attempts > 10) {
            alert("Could not generate a unique code. Please try entering one manually.");
            return;
        }
        const candidate = generateRandomCode();
        if (usingFirebase && db) {
            db.collection("groups").doc(candidate).get().then((doc) => {
                if (doc.exists) {
                    attemptGenerate(attempts + 1);
                } else {
                    document.getElementById('create-group-code').value = candidate;
                }
            }).catch(() => {
                document.getElementById('create-group-code').value = candidate;
            });
        } else {
            const dbObj = getLocalDB();
            if (dbObj.groups[candidate]) {
                attemptGenerate(attempts + 1);
            } else {
                document.getElementById('create-group-code').value = candidate;
            }
        }
    };

    attemptGenerate();
}

function forgotPassword() {
    const email = document.getElementById('login-email').value.trim();
    if (!email) {
        alert("Please enter your email address in the Email field first.");
        return;
    }

    if (usingFirebase) {
        const loader = document.getElementById('loader-view');
        loader.classList.remove('hidden');
        loader.classList.remove('opacity-0');
        firebase.auth().sendPasswordResetEmail(email)
            .then(() => {
                loader.classList.add('hidden');
                alert("Password reset email sent! Check your inbox to change your password.");
            })
            .catch((error) => {
                loader.classList.add('hidden');
                alert("Error sending password reset email: " + error.message);
            });
    } else {
        const localUsers = JSON.parse(localStorage.getItem('gaytm_local_users') || '{}');
        const user = localUsers[email.toLowerCase()];
        if (!user) {
            alert("No registered account found with this email.");
            return;
        }

        sendEmailOTP(user.name, email, 'reset_password', { name: user.name, email });
    }
}

function submitNewPassword() {
    const newPassword = document.getElementById('reset-new-password').value.trim();
    if (newPassword.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
    }

    const { email } = pendingAuthData;
    const localUsers = JSON.parse(localStorage.getItem('gaytm_local_users') || '{}');
    if (localUsers[email.toLowerCase()]) {
        localUsers[email.toLowerCase()].password = newPassword;
        localStorage.setItem('gaytm_local_users', JSON.stringify(localUsers));
        closeModal('reset-password-modal');
        alert("Password updated successfully! You can now log in.");
        document.getElementById('login-password').value = newPassword;
        document.getElementById('reset-new-password').value = '';
    }
}

let cropCallback = null;
let cropImageElement = null;
let cropBoxElement = null;
let cropContainerElement = null;

let imgZoom = 1.0;
let imgLeft = 0;
let imgTop = 0;
let imgWidth = 0;
let imgHeight = 0;
let initWidth = 0;
let initHeight = 0;
let isDraggingImg = false;
let dragStartX = 0;
let dragStartY = 0;
let imgStartLeft = 0;
let imgStartTop = 0;

let isDraggingHandle = false;
let activeHandle = null;
let handleDragStartX = 0;
let handleDragStartY = 0;
let initBoxLeft = 0;
let initBoxTop = 0;
let initBoxWidth = 0;
let initBoxHeight = 0;

function openCropper(base64Source, callback) {
    const img = document.getElementById('crop-image');
    cropCallback = callback;

    // Zoom fixed at 1 (zoom feature removed)
    imgZoom = 1.0;

    img.onload = function () {
        cropContainerElement = document.getElementById('crop-container');
        cropBoxElement = document.getElementById('crop-box');
        cropImageElement = img;

        const containerWidth = cropContainerElement.clientWidth || 300;
        const containerHeight = cropContainerElement.clientHeight || 300;

        const natW = img.naturalWidth || 300;
        const natH = img.naturalHeight || 300;

        // Size to fit container initially
        const r = Math.min(containerWidth / natW, containerHeight / natH);
        initWidth = natW * r;
        initHeight = natH * r;
        imgWidth = initWidth;
        imgHeight = initHeight;

        imgLeft = (containerWidth - imgWidth) / 2;
        imgTop = (containerHeight - imgHeight) / 2;

        img.style.position = 'absolute';
        img.style.width = imgWidth + 'px';
        img.style.height = imgHeight + 'px';
        img.style.left = imgLeft + 'px';
        img.style.top = imgTop + 'px';

        // Crop box — dynamic size: 85% of the container, centered
        const boxSize = Math.min(containerWidth, containerHeight) * 0.85;
        const boxWidth = boxSize;
        const boxHeight = boxSize;
        cropBoxElement.style.width = boxWidth + 'px';
        cropBoxElement.style.height = boxHeight + 'px';
        cropBoxElement.style.left = ((containerWidth - boxWidth) / 2) + 'px';
        cropBoxElement.style.top = ((containerHeight - boxHeight) / 2) + 'px';

        setupCropperEvents();
    };

    img.src = base64Source;
    openModal('crop-modal');

    // Fallback in case onload was already fired or cached
    if (img.complete && img.naturalWidth) {
        img.onload();
    }
}

function setupCropperEvents() {
    cropContainerElement.onmousedown = startImgDrag;
    cropContainerElement.ontouchstart = startImgDrag;

    const handles = cropBoxElement.querySelectorAll('.crop-handle');
    handles.forEach(handle => {
        let direction = 'br';
        if (handle.classList.contains('crop-handle-tl')) direction = 'tl';
        if (handle.classList.contains('crop-handle-tr')) direction = 'tr';
        if (handle.classList.contains('crop-handle-bl')) direction = 'bl';
        if (handle.classList.contains('crop-handle-br')) direction = 'br';

        handle.onmousedown = (e) => startHandleDrag(e, direction);
        handle.ontouchstart = (e) => startHandleDrag(e, direction);
    });

    function startImgDrag(e) {
        if (e.target.classList.contains('crop-handle')) return;
        e.preventDefault();
        isDraggingImg = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        dragStartX = clientX;
        dragStartY = clientY;
        imgStartLeft = imgLeft;
        imgStartTop = imgTop;

        document.onmousemove = doImgDrag;
        document.ontouchmove = doImgDrag;
        document.onmouseup = stopImgDrag;
        document.ontouchend = stopImgDrag;
    }

    function doImgDrag(e) {
        if (!isDraggingImg) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const dx = clientX - dragStartX;
        const dy = clientY - dragStartY;

        imgLeft = imgStartLeft + dx;
        imgTop = imgStartTop + dy;

        cropImageElement.style.left = imgLeft + 'px';
        cropImageElement.style.top = imgTop + 'px';
    }

    function stopImgDrag() {
        isDraggingImg = false;
        document.onmousemove = null;
        document.ontouchmove = null;
        document.onmouseup = null;
        document.ontouchend = null;
    }

    function startHandleDrag(e, direction) {
        e.preventDefault();
        e.stopPropagation();
        isDraggingHandle = true;
        activeHandle = direction;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        handleDragStartX = clientX;
        handleDragStartY = clientY;

        initBoxLeft = cropBoxElement.offsetLeft;
        initBoxTop = cropBoxElement.offsetTop;
        initBoxWidth = cropBoxElement.offsetWidth;
        initBoxHeight = cropBoxElement.offsetHeight;

        document.onmousemove = doHandleDrag;
        document.ontouchmove = doHandleDrag;
        document.onmouseup = stopHandleDrag;
        document.ontouchend = stopHandleDrag;
    }

    function doHandleDrag(e) {
        if (!isDraggingHandle) return;
        e.preventDefault();

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const dx = clientX - handleDragStartX;
        const dy = clientY - handleDragStartY;

        const containerWidth = cropContainerElement.clientWidth || 300;
        const containerHeight = cropContainerElement.clientHeight || 300;

        let newSize = initBoxWidth;
        let newLeft = initBoxLeft;
        let newTop = initBoxTop;

        if (activeHandle === 'br') {
            newSize = initBoxWidth + dx;
            newSize = Math.max(50, Math.min(newSize, containerWidth - initBoxLeft, containerHeight - initBoxTop));
        } else if (activeHandle === 'bl') {
            newSize = initBoxWidth - dx;
            const maxSize = Math.min(initBoxLeft + initBoxWidth, containerHeight - initBoxTop);
            newSize = Math.max(50, Math.min(newSize, maxSize));
            newLeft = initBoxLeft + initBoxWidth - newSize;
        } else if (activeHandle === 'tr') {
            newSize = initBoxWidth + dx;
            const maxSize = Math.min(initBoxTop + initBoxHeight, containerWidth - initBoxLeft);
            newSize = Math.max(50, Math.min(newSize, maxSize));
            newTop = initBoxTop + initBoxHeight - newSize;
        } else if (activeHandle === 'tl') {
            newSize = initBoxWidth - dx;
            const maxSize = Math.min(initBoxLeft + initBoxWidth, initBoxTop + initBoxHeight);
            newSize = Math.max(50, Math.min(newSize, maxSize));
            newLeft = initBoxLeft + initBoxWidth - newSize;
            newTop = initBoxTop + initBoxHeight - newSize;
        }

        cropBoxElement.style.width = newSize + 'px';
        cropBoxElement.style.height = newSize + 'px';
        cropBoxElement.style.left = newLeft + 'px';
        cropBoxElement.style.top = newTop + 'px';
    }

    function stopHandleDrag() {
        isDraggingHandle = false;
        document.onmousemove = null;
        document.ontouchmove = null;
        document.onmouseup = null;
        document.ontouchend = null;
    }
}

// Zoom feature removed — stub kept to avoid errors if called
function updateCropImageZoom() {}

function performCrop() {
    const img = cropImageElement;
    const box = cropBoxElement;
    const container = cropContainerElement;

    if (!img || !box || !container) return;

    const natWidth = img.naturalWidth;
    const natHeight = img.naturalHeight;

    // Crop box position relative to the panned/zoomed image
    let boxLeft = box.offsetLeft - imgLeft;
    let boxTop = box.offsetTop - imgTop;
    let boxWidth = box.offsetWidth;
    let boxHeight = box.offsetHeight;

    // Convert coordinates to natural image scale
    const scaleX = natWidth / imgWidth;
    const scaleY = natHeight / imgHeight;

    const cropX = boxLeft * scaleX;
    const cropY = boxTop * scaleY;
    const cropW = boxWidth * scaleX;
    const cropH = boxHeight * scaleY;

    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d');

    const tempImg = new Image();
    tempImg.onload = function () {
        ctx.drawImage(tempImg, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        const croppedBase64 = canvas.toDataURL('image/jpeg', 0.9);
        closeModal('crop-modal');
        if (cropCallback) {
            cropCallback(croppedBase64);
        }
    };
    tempImg.src = img.src;
}

function compressBase64Image(base64Str, maxSizeKB = 800, initialQuality = 0.85) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            const MAX_DIM = 1200;
            if (width > MAX_DIM || height > MAX_DIM) {
                if (width > height) {
                    height = Math.round(height * MAX_DIM / width);
                    width = MAX_DIM;
                } else {
                    width = Math.round(width * MAX_DIM / height);
                    height = MAX_DIM;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            let quality = initialQuality;
            let result = canvas.toDataURL('image/jpeg', quality);
            while (result.length * 0.75 > maxSizeKB * 1024 && quality > 0.2) {
                quality -= 0.08;
                result = canvas.toDataURL('image/jpeg', quality);
            }
            resolve(result);
        };
        img.onerror = () => resolve(base64Str);
        img.src = base64Str;
    });
}

// --- CHATBOX & FEED NOTIFICATION LOGIC ---

function getDebtStatusText(name) {
    if (typeof calculateNetDebts !== 'function') return 'All settled up';
    const netDebts = calculateNetDebts();
    const debtToFriend = netDebts.find(d =>
        d.from.toLowerCase() === CURRENT_USER.toLowerCase() &&
        d.to.toLowerCase() === name.toLowerCase());
    const debtFromFriend = netDebts.find(d =>
        d.from.toLowerCase() === name.toLowerCase() &&
        d.to.toLowerCase() === CURRENT_USER.toLowerCase());

    if (debtToFriend) {
        return `You owe: ₹${debtToFriend.amount.toFixed(2)}`;
    } else if (debtFromFriend) {
        return `Owes you: ₹${debtFromFriend.amount.toFixed(2)}`;
    } else {
        return `All settled up`;
    }
}

function openChatbox(name, uid) {
    activeChatUser = name;
    activeChatUid = uid;
    isChatboxOpen = true;

    // Set user name
    const nameEl = document.getElementById('chatbox-user-name');
    if (nameEl) nameEl.innerText = name;

    // Set avatar
    const avatarEl = document.getElementById('chatbox-user-avatar');
    if (avatarEl) {
        const member = users.find(u => u.name === name);
        avatarEl.src = member ? member.avatar : 'https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder';
    }

    // Set debt status
    const statusEl = document.getElementById('chatbox-user-status');
    if (statusEl) {
        statusEl.innerText = getDebtStatusText(name);
    }

    // Creator "Kick Out" button visibility
    const kickBtn = document.getElementById('chatbox-kick-btn');
    if (kickBtn) {
        const admin = getGroupAdmin();
        const isCreator = (admin && admin.toLowerCase() === CURRENT_USER.toLowerCase());
        const isMe = name.toLowerCase() === CURRENT_USER.toLowerCase();

        if (isCreator && !isMe) {
            kickBtn.classList.remove('hidden');
            kickBtn.onclick = () => {
                closeModal('chatbox-modal');
                removeMember(name, uid);
            };
        } else {
            kickBtn.classList.add('hidden');
        }
    }

    // Input reset
    const input = document.getElementById('chatbox-input');
    if (input) input.value = '';

    openModal('chatbox-modal');
    renderChatMessages();

    // Auto-focus the input so keyboard opens on mobile and laptop is ready to type
    setTimeout(() => {
        const chatInput = document.getElementById('chatbox-input');
        if (chatInput && document.activeElement !== chatInput) {
            chatInput.focus();
        }
    }, 350); // slight delay to let the modal slide-in animation finish
}

function sendChatMessage() {
    // Guard: kicked/removed user cannot send messages
    if (!CURRENT_GROUP || !CURRENT_USER) {
        alert('You are not in an active group. You cannot send messages.');
        closeModal('chatbox-modal');
        return;
    }
    // In fallback mode with empty users array, skip membership check
    // (we can't verify without Firestore data, but the user was a member before)
    if (users.length > 0) {
        let isMember = false;
        if (usingFirebase && firebase.auth().currentUser) {
            const currentUid = firebase.auth().currentUser.uid;
            isMember = users.some(u => u.uid === currentUid);
        }
        if (!isMember) {
            isMember = users.some(u => u.name.trim().toLowerCase() === CURRENT_USER.trim().toLowerCase());
        }
        if (!isMember) {
            alert('You are no longer a member of this group and cannot send messages.');
            closeModal('chatbox-modal');
            return;
        }
    }

    const input = document.getElementById('chatbox-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const newMsg = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        from: CURRENT_USER,
        to: activeChatUser,
        text: text,
        timestamp: Date.now()
    };

    if (usingFirebase) {
        db.collection("groups").doc(CURRENT_GROUP).collection("chats").add({
            from: CURRENT_USER,
            to: activeChatUser,
            text: text,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            input.value = '';
            if (document.activeElement !== input) {
                input.focus(); // keep keyboard open after sending
            }
        }).catch(err => {
            console.error("Error sending message to Firebase: ", err);
        });
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData) {
            if (!groupData.chats) groupData.chats = [];
            groupData.chats.push(newMsg);
            saveLocalDB(dbObj);
            groupChats = groupData.chats;
            input.value = '';
            if (document.activeElement !== input) {
                input.focus(); // keep keyboard open after sending
            }
            renderChatMessages();
        }
    }
}

// Long-press detection helpers
function startChatLongPress(msgId, text, event) {
    clearTimeout(chatLongPressTimer);
    chatLongPressTimer = setTimeout(() => {
        openChatMsgOptions(msgId, text);
        // vibrate on devices that support it to indicate long press
        if (navigator.vibrate) navigator.vibrate(50);
    }, 600);
}

function cancelChatLongPress() {
    clearTimeout(chatLongPressTimer);
}

function openChatMsgOptions(msgId, text) {
    activeOptionsMsgId = msgId;
    activeOptionsMsgText = text;
    openModal('chat-msg-options-modal');
}

function editChatMessage() {
    if (!activeOptionsMsgId) return;

    // Quick prompt for editing
    const newText = prompt("Edit message:", activeOptionsMsgText);
    if (newText === null || newText.trim() === "" || newText.trim() === activeOptionsMsgText) {
        closeModal('chat-msg-options-modal');
        return;
    }

    if (usingFirebase) {
        db.collection("groups").doc(CURRENT_GROUP).collection("chats").doc(activeOptionsMsgId).update({
            text: newText.trim()
        }).then(() => {
            closeModal('chat-msg-options-modal');
        }).catch(err => alert("Failed to edit: " + err.message));
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData && groupData.chats) {
            const idx = groupData.chats.findIndex(m => m.id === activeOptionsMsgId);
            if (idx !== -1) {
                groupData.chats[idx].text = newText.trim();
                saveLocalDB(dbObj);
                groupChats = groupData.chats;
                renderChatMessages();
            }
        }
        closeModal('chat-msg-options-modal');
    }
}

function unsendChatMessage() {
    if (!activeOptionsMsgId) return;

    if (!confirm("Are you sure you want to unsend this message?")) {
        return;
    }

    if (usingFirebase) {
        db.collection("groups").doc(CURRENT_GROUP).collection("chats").doc(activeOptionsMsgId).delete()
            .then(() => {
                closeModal('chat-msg-options-modal');
            }).catch(err => alert("Failed to unsend: " + err.message));
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData && groupData.chats) {
            groupData.chats = groupData.chats.filter(m => m.id !== activeOptionsMsgId);
            saveLocalDB(dbObj);
            groupChats = groupData.chats;
            renderChatMessages();
        }
        closeModal('chat-msg-options-modal');
    }
}

function wipeLocalChat() {
    if (!CURRENT_GROUP || !CURRENT_USER || !activeChatUser) return;
    if (confirm(`Are you sure you want to wipe this chat? It will only clear for you and remain visible to others.`)) {
        localStorage.setItem(`gaytm_chat_wiped_timestamp_${CURRENT_GROUP}_${CURRENT_USER}_${activeChatUser}`, Date.now().toString());
        renderChatMessages();
    }
}

function renderChatMessages() {
    const container = document.getElementById('chatbox-messages');
    if (!container) return;
    container.innerHTML = '';

    // Mark as read ONLY if the chatbox is actually visible on screen.
    // If it's hidden/minimized, new messages should still trigger the red dot.
    const chatboxModalEl = document.getElementById('chatbox-modal');
    const isChatboxVisible = chatboxModalEl && !chatboxModalEl.classList.contains('hidden');
    if (activeChatUser && isChatboxVisible) {
        updateChatLastSeen(activeChatUser);
    }
    renderGroupMembers();
    updateHomeNotificationDot();

    const wipedTimestamp = parseInt(localStorage.getItem(`gaytm_chat_wiped_timestamp_${CURRENT_GROUP}_${CURRENT_USER}_${activeChatUser}`)) || 0;
    const filteredChats = groupChats.filter(msg => {
        const fromVal = msg.from || '';
        const toVal = msg.to || '';
        const isMatch = (fromVal.toLowerCase() === CURRENT_USER.toLowerCase() && toVal.toLowerCase() === activeChatUser.toLowerCase()) ||
            (fromVal.toLowerCase() === activeChatUser.toLowerCase() && toVal.toLowerCase() === CURRENT_USER.toLowerCase());
        return isMatch && (msg.timestamp > wipedTimestamp);
    });

    container.className = `flex-1 overflow-y-auto p-4 custom-scrollbar bg-zinc-50 dark:bg-black/20 pb-20 pt-6 space-y-3 relative theme-${CURRENT_CHAT_THEME}`;

    if (filteredChats.length === 0) {
        container.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-zinc-400 p-4 text-center">
                <i data-lucide="message-square" class="w-8 h-8 opacity-45 mb-2"></i>
                <p class="text-xs">No messages yet. Say hello!</p>
            </div>
        `;
        if (typeof lucide !== 'undefined') { lucide.createIcons(); }
        return;
    }

    filteredChats.forEach(msg => {
        const isMe = msg.from.toLowerCase() === CURRENT_USER.toLowerCase();

        let msgTime = '';
        if (msg.timestamp) {
            const dateVal = new Date(msg.timestamp);
            msgTime = dateVal.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        const bubbleClass = isMe
            ? 'chat-bubble-me bg-indigo-600 text-white rounded-2xl rounded-tr-none shadow-sm cursor-pointer select-none'
            : 'chat-bubble-other bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-2xl rounded-tl-none shadow-sm cursor-pointer select-none';

        const safeText = msg.text.replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const longPressHandlers = isMe && msg.id
            ? `onmousedown="startChatLongPress('${msg.id}', '${safeText}', event)" onmouseup="cancelChatLongPress()" onmouseleave="cancelChatLongPress()" ontouchstart="startChatLongPress('${msg.id}', '${safeText}', event)" ontouchend="cancelChatLongPress()" ontouchmove="cancelChatLongPress()"`
            : '';

        // --- Double tick (seen receipt) for MY messages ---
        let tickSvg = '';
        if (isMe) {
            let isSeen = false;
            if (usingFirebase) {
                // chatLastRead is synced to Firestore member doc by updateChatLastSeen
                const recipientMember = users.find(u =>
                    activeChatUid ? u.uid === activeChatUid : (u.name || '').toLowerCase() === activeChatUser.toLowerCase()
                );
                const theirLastRead = ((recipientMember || {}).chatLastRead || {})[CURRENT_USER] || 0;
                isSeen = msg.timestamp && theirLastRead >= msg.timestamp;
            } else {
                // Local mode: read the other user's localStorage entry directly
                try {
                    const theirKey = `gaytm_chat_last_seen_${CURRENT_GROUP}_${activeChatUser}`;
                    const theirLastSeen = JSON.parse(localStorage.getItem(theirKey)) || {};
                    isSeen = msg.timestamp && (theirLastSeen[CURRENT_USER] || 0) >= msg.timestamp;
                } catch (e) {}
            }
            if (isSeen) {
                // Double tick (seen)
                tickSvg = `<svg viewBox="0 0 16 11" width="14" height="10" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;margin-bottom:1px" title="Seen">
                    <path d="M1 5.5L4.5 9L10 1" fill="none" stroke="#0284c7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M5 5.5L8.5 9L14 1" fill="none" stroke="#0284c7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>`;
            } else {
                // Single tick (sent)
                tickSvg = `<svg viewBox="0 0 16 11" width="14" height="10" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;margin-bottom:1px" title="Sent">
                    <path d="M1 5.5L4.5 9L10 1" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>`;
            }
        }

        container.innerHTML += `
            <div class="flex flex-col w-full mb-3">
                <div class="flex flex-col max-w-[75%] ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}">
                    <div class="p-3 text-sm font-medium ${bubbleClass} break-words transition-opacity active:opacity-75" ${longPressHandlers}>
                        ${msg.text}
                    </div>
                    <div class="flex items-center gap-1 mt-1 px-1">
                        <span class="text-[9px] text-zinc-500 dark:text-zinc-400">${msgTime}</span>
                        ${tickSvg}
                    </div>
                </div>
            </div>
        `;
    });

    container.scrollTop = container.scrollHeight;
}

function checkFeedNotificationDot() {
    if (!CURRENT_GROUP || !CURRENT_USER) return;

    // If we are actively looking at the moments tab, update last viewed timestamp and hide dot.
    const momentsTab = document.querySelector('[data-tab="moments"]');
    const isMomentsTabActive = momentsTab && momentsTab.classList.contains('text-indigo-600');
    if (isMomentsTabActive) {
        localStorage.setItem('gaytm_last_feed_viewed_' + CURRENT_GROUP, Date.now().toString());
        const dot = document.getElementById('feed-notification-dot');
        if (dot) dot.classList.add('hidden');
        return;
    }

    const lastViewed = parseInt(localStorage.getItem('gaytm_last_feed_viewed_' + CURRENT_GROUP)) || 0;

    const hasNewMoments = moments.some(m => {
        if (m.user === CURRENT_USER) return false;

        let mTime = 0;
        if (m.timestamp) {
            mTime = m.timestamp;
        } else if (m.id && m.id.startsWith('moment_')) {
            mTime = parseInt(m.id.split('_')[1]) || 0;
        }
        return mTime > lastViewed;
    });

    const dot = document.getElementById('feed-notification-dot');
    if (dot) {
        if (hasNewMoments) {
            dot.classList.remove('hidden');
        } else {
            dot.classList.add('hidden');
        }
    }
}



