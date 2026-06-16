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

// Dynamic State Arrays (populated from group database)
let users = [];
let expenses = [];
let moments = [];

let selectedSplitUsers = [];
let momentImageBase64 = null;
let qrImageBase64 = null;
let joinRequests = [];
let groupAdmin = null;
let chartMode = 'category';
let expenseImageBase64 = null;

// --- LOCAL STORAGE DATABASE SIMULATOR (Offline Demo) ---
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

function syncLocalGroupData() {
    if (usingFirebase) return;
    const dbObj = getLocalDB();
    const groupData = dbObj.groups[CURRENT_GROUP];
    if (groupData) {
        users = groupData.members || [];
        expenses = groupData.expenses || [];
        moments = groupData.moments || [];
        joinRequests = groupData.joinRequests || [];
    } else {
        users = [];
        expenses = [];
        moments = [];
        joinRequests = [];
    }

    const currentUserObj = users.find(u => u.name === CURRENT_USER);
    if (currentUserObj) {
        document.getElementById('header-avatar').src = currentUserObj.avatar;
        document.getElementById('profile-avatar-large').src = currentUserObj.avatar;
        document.getElementById('profile-upi').innerText = currentUserObj.upi || 'Add your UPI';
    }

    renderDashboard();
    renderSplit();
    renderMoments();
    renderPay();
    renderSquadMembers();
    renderJoinRequests();
}

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

function startFirebaseSync() {
    if (!usingFirebase || !CURRENT_GROUP) return;

    // Unsubscribe existing listeners if any
    if (unsubscribeMembers) unsubscribeMembers();
    if (unsubscribeExpenses) unsubscribeExpenses();
    if (unsubscribeMoments) unsubscribeMoments();
    if (unsubscribeJoinRequests) unsubscribeJoinRequests();

    const groupRef = db.collection("groups").doc(CURRENT_GROUP);

    // Cache the group admin for join request rendering
    groupRef.get().then((doc) => {
        if (doc.exists) {
            groupAdmin = doc.data().createdBy || null;
            renderJoinRequests(); // Re-render now that we know who's admin
        }
    }).catch(() => {});

    // Sync Group Members
    unsubscribeMembers = groupRef.collection("members").onSnapshot((snapshot) => {
        users = [];
        snapshot.forEach((doc) => {
            users.push(doc.data());
        });
        renderSplitUsers(); // Redraw checkbox options in split bill modal
        renderPay();        // Redraw squad list on Pay tab
        renderSquadMembers(); // Redraw squad member chips on Dashboard

        // Keep avatar in sync
        const currentUserObj = users.find(u => usingFirebase ? (u.uid === (firebase.auth().currentUser ? firebase.auth().currentUser.uid : '')) : (u.name === CURRENT_USER));
        if (currentUserObj) {
            document.getElementById('header-avatar').src = currentUserObj.avatar;
            document.getElementById('profile-avatar-large').src = currentUserObj.avatar;
            document.getElementById('profile-upi').innerText = currentUserObj.upi;
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
                time: data.timestamp ? formatDate(data.timestamp.toDate()) : 'Just now'
            });
        });
        renderMoments();
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
            document.getElementById('otp-description').innerText = `We sent a 6-digit verification code to ${email}. (Sandbox Code: ${generatedOTP})`;
        });
    } else {
        // Local Sandbox Mode: Display OTP code directly in the UI text for developer testing
        document.getElementById('otp-description').innerText = `We sent a 6-digit verification code to ${email}. (Sandbox Code: ${generatedOTP})`;
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
        } else {
            // Offline Simulator Mode login completion
            setTimeout(() => {
                CURRENT_USER = name;
                // Scope localStorage to this user's email
                const userNs = (email || name).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                localStorage.setItem('gaytm_active_user_ns', userNs);
                localStorage.setItem('gaytm_user', CURRENT_USER);
                localStorage.setItem('gaytm_user_email', email);

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
                    initApp();
                }, 400);
            }, 1000);
        }
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
    lucide.createIcons();
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
        setTimeout(() => {
            const localUsers = JSON.parse(localStorage.getItem('gaytm_local_users') || '{}');
            const user = localUsers[email.toLowerCase()];

            if (user && user.password === password) {
                loader.classList.add('hidden');
                sendEmailOTP(user.name, email, 'login', { name: user.name, email, password });
            } else {
                loader.classList.add('hidden');
                isSigningIn = false;
                alert("Login failed: Invalid email or password.");
            }
        }, 1000);
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

                // Not a member — send join request
                const requestObj = {
                    uid: currentUser ? currentUser.uid : '',
                    name: CURRENT_USER,
                    email: currentUser ? currentUser.email : '',
                    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${CURRENT_USER}&backgroundColor=c7d2fe`,
                    requestedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                groupRef.collection("joinRequests").doc(memberId).set(requestObj).then(() => {
                    setUserItem('pending_request_group', groupCode);
                    alert("✅ Join request sent! The group admin needs to approve your request for: " + groupName);
                    initApp(); // re-route to show pending banner
                }).catch(err => {
                    alert("Error sending join request: " + err.message);
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

        // Check if already requested
        if (!groupData.joinRequests) groupData.joinRequests = [];
        if (groupData.joinRequests.some(r => r.name.toLowerCase() === CURRENT_USER.toLowerCase())) {
            alert("You've already sent a join request for this group. Please wait for the admin to approve.");
            return;
        }

        groupData.joinRequests.push({
            name: CURRENT_USER,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${CURRENT_USER}&backgroundColor=c7d2fe`,
            requestedAt: new Date().toISOString()
        });
        saveLocalDB(dbObj);
        setUserItem('pending_request_group', groupCode);
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

    if (usingFirebase) {
        const groupRef = db.collection("groups").doc(groupCode);
        // Check if group code already exists
        groupRef.get().then((doc) => {
            if (doc.exists) {
                alert("This group code is already taken! Try a different code.");
                return;
            }

            groupRef.set({
                name: groupNameInput,
                createdBy: CURRENT_USER,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => {
                const currentUser = firebase.auth().currentUser;
                const newUserObj = {
                    uid: currentUser ? currentUser.uid : '',
                    name: CURRENT_USER,
                    upi: `${CURRENT_USER.toLowerCase()}@okaxis`,
                    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${CURRENT_USER}&backgroundColor=c7d2fe`
                };
                const memberId = currentUser ? currentUser.uid : CURRENT_USER;
                return groupRef.collection("members").doc(memberId).set(newUserObj);
            }).then(() => {
                addToUserGroupsList(groupCode, groupNameInput);
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

        dbObj.groups[groupCode] = {
            name: groupNameInput,
            createdBy: CURRENT_USER,
            members: [{
                name: CURRENT_USER,
                upi: `${CURRENT_USER.toLowerCase()}@okaxis`,
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${CURRENT_USER}&backgroundColor=c7d2fe`
            }],
            expenses: [],
            moments: [],
            joinRequests: []
        };
        saveLocalDB(dbObj);

        addToUserGroupsList(groupCode, groupNameInput);
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

function addToUserGroupsList(code, name) {
    const groups = getUserGroupsList();
    if (!groups.some(g => g.code === code)) {
        groups.push({ code, name });
        setUserItem('user_groups', JSON.stringify(groups));
    }
}

function removeFromUserGroupsList(code) {
    let groups = getUserGroupsList();
    groups = groups.filter(g => g.code !== code);
    setUserItem('user_groups', JSON.stringify(groups));
}

// --- PENDING REQUEST BANNER ---
let pendingApprovalListener = null;

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
    lucide.createIcons();

    // Set up real-time approval listener in Firebase
    if (usingFirebase && db) {
        if (pendingApprovalListener) pendingApprovalListener();
        
        const memberId = firebase.auth().currentUser?.uid || CURRENT_USER;
        pendingApprovalListener = db.collection('groups').doc(groupCode).collection('members').doc(memberId).onSnapshot(doc => {
            if (doc.exists) {
                // Approved!
                if (pendingApprovalListener) {
                    pendingApprovalListener();
                    pendingApprovalListener = null;
                }
                removeUserItem('pending_request_group');
                setUserItem('group', groupCode);
                
                db.collection('groups').doc(groupCode).get().then(gDoc => {
                    const name = gDoc.exists ? (gDoc.data().name || groupCode) : groupCode;
                    setUserItem('group_name', name);
                    CURRENT_GROUP = groupCode;
                    CURRENT_GROUP_NAME = name;
                    
                    // Trigger success animation
                    triggerConfetti();
                    initApp();
                });
            }
        }, err => console.log("Approval listener error:", err));
    }
}

function cancelPendingRequest(groupCode) {
    if (!confirm('Are you sure you want to cancel your join request?')) return;
    
    if (pendingApprovalListener) {
        pendingApprovalListener();
        pendingApprovalListener = null;
    }
    
    removeUserItem('pending_request_group');
    
    const existingBanner = document.getElementById('pending-request-banner');
    if (existingBanner) existingBanner.remove();

    if (usingFirebase && db) {
        const memberId = firebase.auth().currentUser?.uid || CURRENT_USER;
        db.collection('groups').doc(groupCode).collection('joinRequests').doc(memberId).delete().catch(() => {});
    } else {
        const dbObj = getLocalDB();
        const gd = dbObj.groups[groupCode];
        if (gd && gd.joinRequests) {
            gd.joinRequests = gd.joinRequests.filter(r => r.name !== CURRENT_USER);
            saveLocalDB(dbObj);
        }
    }
    initApp();
}

// --- DELETE / WIPE GROUP ---
function deleteGroupCompletely() {
    if (!CURRENT_GROUP) { alert('No active group to delete.'); return; }
    const isAdmin = getGroupAdmin() === CURRENT_USER;
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
    const isAdmin = getGroupAdmin() === CURRENT_USER;
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
            // Show dashboard with pending-request banner
            switchTab('dashboard', false);
            showPendingRequestBanner(pendingReqGroup);
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
        renderSquadMembers();
        renderJoinRequests();
    }
    // Pre-select current user by default for expenses
    selectedSplitUsers = [CURRENT_USER];
    renderSplitUsers();

    // Render active groups list & current group details info card
    renderMyGroups();
    renderGroupInfo();
    
    // Refresh Lucide Icons for dynamically rendered controls
    lucide.createIcons();
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

    document.getElementById('dash-my-spent').innerText = `₹${myTotalSpent.toFixed(2)}`;

    const balEl = document.getElementById('dash-you-owe');
    const labelEl = document.getElementById('dash-balance-label');
    const parentCard = balEl?.parentElement?.parentElement; // the stat card div

    // Calculate netting balances first to get correct netted netBalance
    const { netBalance: nettedNetBalance } = renderSettlementBreakdown();

    if (balEl) {
        if (nettedNetBalance < 0) {
            balEl.innerText = `₹${Math.abs(nettedNetBalance).toFixed(2)}`;
            if (labelEl) labelEl.innerText = "You Owe";
            if (parentCard) parentCard.className = 'stat-card-orange p-4 flex flex-col justify-between';
        } else if (nettedNetBalance > 0) {
            balEl.innerText = `₹${nettedNetBalance.toFixed(2)}`;
            if (labelEl) labelEl.innerText = "You Are Owed";
            if (parentCard) parentCard.className = 'stat-card-green p-4 flex flex-col justify-between';
        } else {
            balEl.innerText = `₹0.00`;
            if (labelEl) labelEl.innerText = "All Settled";
            if (parentCard) parentCard.className = 'stat-card-pink p-4 flex flex-col justify-between';
        }
    }

    // Show admin danger zone if user is the group creator
    const dangerZone = document.getElementById('admin-danger-zone');
    if (dangerZone) {
        const admin = getGroupAdmin();
        if (admin && admin === CURRENT_USER) {
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
    lucide.createIcons();
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

            // Edit split button if created by current user
            let editSplitBtn = '';
            if (isMe) {
                editSplitBtn = `
                    <button onclick="openEditSplitModal('${exp.id}')" class="text-[10px] font-bold text-indigo-600 hover:underline flex items-center gap-1 mt-1.5">
                        <i data-lucide="edit-3" class="w-2.5 h-2.5"></i> Edit Split Members
                    </button>
                `;
            }

            const imageHtml = exp.image ? `
                <div class="mt-2.5 w-full h-48 overflow-hidden rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center relative">
                    <img src="${exp.image}" class="w-full h-full object-contain" />
                </div>
            ` : '';

            listEl.innerHTML += `
                <div class="glass-card p-4 flex flex-col justify-between">
                    <div class="flex items-start gap-3 w-full">
                        <div class="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-500 flex-shrink-0 mt-1">
                            <i data-lucide="receipt" class="w-5 h-5 text-indigo-500"></i>
                        </div>
                        <div class="flex-1 text-left">
                            <div class="flex justify-between items-start">
                                <h4 class="font-black text-zinc-950 dark:text-zinc-50 text-sm">${exp.desc} <span class="text-sm font-black text-indigo-600 dark:text-indigo-400">(Paid by ${isMe ? 'You' : exp.paidBy})</span></h4>
                                <p class="font-black text-base text-zinc-950 dark:text-zinc-50">₹${exp.amount.toFixed(2)}</p>
                            </div>
                            ${commentHtml}
                            ${imageHtml}
                            <div class="mt-2.5 flex justify-between items-center border-t border-zinc-100 dark:border-zinc-850 pt-2.5">
                                <p class="text-[10px] text-zinc-800 dark:text-zinc-300 font-black uppercase tracking-wider">Split with ${exp.splitWith.length} friends</p>
                                <span class="${myStatusColor}">${myStatus}</span>
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
    lucide.createIcons();
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
        lucide.createIcons();
        return;
    }

    moments.forEach((m, idx) => {
        const momentId = m.id || ('moment_' + idx);
        if (!m.likes) m.likes = [];
        const liked = m.likes.includes(CURRENT_USER);
        const likeCount = m.likes.length;

        if (!m.comments) m.comments = [];

        const userObj = users.find(u => u.name === m.user);
        const avatarSrc = userObj?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${m.user}&backgroundColor=c7d2fe`;
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
                <div class="w-full overflow-hidden bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center h-[450px]">
                    <img src="${m.image}" class="w-full h-full object-contain" />
                </div>
            ` : ''}

            <!-- Card Body / Actions -->
            <div class="p-3.5 text-left">
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

    lucide.createIcons();
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
                <p class="text-sm">No other squad members in this group yet.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    const netDebts = calculateNetDebts();

    otherFriends.forEach(u => {
        const debtToFriend = netDebts.find(d => d.from.toLowerCase() === CURRENT_USER.toLowerCase() && d.to.toLowerCase() === u.name.toLowerCase());
        const debtFromFriend = netDebts.find(d => d.from.toLowerCase() === u.name.toLowerCase() && d.to.toLowerCase() === CURRENT_USER.toLowerCase());
        let amountText = "Settled up";
        let amountClass = "text-zinc-400 dark:text-zinc-500 font-semibold";

        if (debtToFriend) {
            amountText = `You owe: ₹${debtToFriend.amount.toFixed(2)}`;
            amountClass = "text-red-600 dark:text-red-400 font-bold";
        } else if (debtFromFriend) {
            amountText = `Owes you: ₹${debtFromFriend.amount.toFixed(2)}`;
            amountClass = "text-emerald-600 dark:text-emerald-400 font-bold";
        }

        const buttonText = debtToFriend ? `Pay ₹${debtToFriend.amount.toFixed(2)}` : "Pay";
        list.innerHTML += `
            <div class="glass-card p-4 flex flex-col items-center text-center cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors active:scale-95" onclick="openQRModal('${u.name}')">
                <img src="${u.avatar}" class="w-12 h-12 rounded-full border border-zinc-200 dark:border-zinc-800 shadow-sm mb-2 object-cover bg-zinc-100" />
                <h4 class="font-bold text-zinc-800 dark:text-zinc-200 text-sm mb-1">${u.name}</h4>
                <p class="text-[10px] ${amountClass} mb-3">${amountText}</p>
                <button class="pay-btn w-full text-xs font-semibold py-2 rounded-lg transition-colors active:scale-95">${buttonText}</button>
            </div>
        `;
    });
}

// --- SQUAD MEMBERS & JOIN REQUEST RENDERING ---

function renderSquadMembers() {
    const container = document.getElementById('dash-squad-members');
    if (!container) return;
    container.innerHTML = '';

    if (users.length === 0) {
        container.innerHTML = `<p class="text-xs text-zinc-400">No members yet.</p>`;
        return;
    }

    users.forEach(u => {
        const isMe = u.name === CURRENT_USER;
        container.innerHTML += `
            <div class="flex flex-col items-center gap-1 w-14">
                <img src="${u.avatar}" class="w-10 h-10 rounded-full border-2 ${isMe ? 'border-indigo-400' : 'border-zinc-200'} shadow-sm object-cover bg-zinc-100" />
                <span class="text-[10px] font-semibold ${isMe ? 'text-indigo-600' : 'text-zinc-600'} truncate w-full text-center">${isMe ? 'You' : u.name}</span>
            </div>
        `;
    });
    lucide.createIcons();
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

function renderJoinRequests() {
    const section = document.getElementById('dash-join-requests');
    const list = document.getElementById('join-requests-list');
    if (!section || !list) return;

    const admin = getGroupAdmin();
    const isAdmin = admin && admin === CURRENT_USER;

    if (!isAdmin || joinRequests.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    list.innerHTML = '';

    joinRequests.forEach(req => {
        list.innerHTML += `
            <div class="glass-card p-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <img src="${req.avatar}" class="w-10 h-10 rounded-full border border-zinc-200 shadow-sm" />
                    <div>
                        <p class="font-semibold text-zinc-800 text-sm">${req.name}</p>
                        <p class="text-[10px] text-zinc-400">Wants to join</p>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="approveJoinRequest('${req.name}')"
                        class="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors active:scale-95">
                        <i data-lucide="check" class="w-3.5 h-3.5 inline"></i> Accept
                    </button>
                    <button onclick="rejectJoinRequest('${req.name}')"
                        class="bg-red-50 text-red-600 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors active:scale-95">
                        <i data-lucide="x" class="w-3.5 h-3.5 inline"></i>
                    </button>
                </div>
            </div>
        `;
    });
    lucide.createIcons();
}

function approveJoinRequest(name) {
    const req = joinRequests.find(r => r.name === name);
    if (!req) return;

    const newMember = {
        name: req.name,
        upi: `${req.name.toLowerCase()}@okaxis`,
        avatar: req.avatar
    };

    if (usingFirebase) {
        const groupRef = db.collection("groups").doc(CURRENT_GROUP);
        const memberId = req.uid || req.name;

        if (req.uid) newMember.uid = req.uid;

        groupRef.collection("members").doc(memberId).set(newMember).then(() => {
            return groupRef.collection("joinRequests").doc(memberId).delete();
        }).then(() => {
            // Firebase listeners will auto-update UI
        }).catch(err => {
            alert("Error approving request: " + err.message);
        });
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData) {
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

    // Also ensure the current group is in the list
    if (CURRENT_GROUP && !groups.some(g => g.code === CURRENT_GROUP)) {
        addToUserGroupsList(CURRENT_GROUP, CURRENT_GROUP_NAME);
        groups.push({ code: CURRENT_GROUP, name: CURRENT_GROUP_NAME });
    }

    let htmlContent = '';

    if (groups.length === 0) {
        htmlContent = `
            <div class="text-center py-6 text-zinc-400">
                <i data-lucide="folder-open" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
                <p class="text-sm">You haven't joined any groups yet.</p>
            </div>
        `;
    } else {
        groups.forEach(g => {
            const isActive = g.code === CURRENT_GROUP;
            htmlContent += `
                <div class="glass-card p-4 flex items-center justify-between ${isActive ? 'border-indigo-300 bg-indigo-50/50' : ''}">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-500'} rounded-lg flex items-center justify-center shrink-0">
                            <i data-lucide="${isActive ? 'check-circle' : 'users'}" class="w-5 h-5"></i>
                        </div>
                        <div class="min-w-0">
                            <p class="font-semibold text-zinc-800 dark:text-zinc-200 text-sm truncate">${g.name}</p>
                            <p class="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-bold tracking-wider">CODE: ${g.code}${isActive ? ' • Active' : ''}</p>
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
    }

    if (list) list.innerHTML = htmlContent;
    if (tabList) tabList.innerHTML = htmlContent;

    lucide.createIcons();
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

    if (content.classList.contains('translate-y-full') === false && id !== 'qr-modal' && id !== 'otp-modal') {
        content.classList.add('translate-y-full');
    }
    if (id === 'qr-modal' || id === 'otp-modal') {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }

    setTimeout(() => {
        modal.classList.add('hidden');
        // Reset Forms
        if (id === 'expense-modal') {
            document.getElementById('expense-desc').value = '';
            document.getElementById('expense-amount').value = '';
            document.getElementById('expense-comment').value = '';
            selectedSplitUsers = [CURRENT_USER];
            renderSplitUsers();

            const expImgInput = document.getElementById('expense-image-input');
            if (expImgInput) expImgInput.value = '';
            const expImgPreview = document.getElementById('expense-image-preview');
            if (expImgPreview) {
                expImgPreview.src = '';
                expImgPreview.classList.add('hidden');
            }
            const expImgPlaceholder = document.getElementById('expense-image-placeholder');
            if (expImgPlaceholder) expImgPlaceholder.classList.remove('hidden');
            expenseImageBase64 = null;
        } else if (id === 'moment-modal') {
            document.getElementById('moment-caption').value = '';
            document.getElementById('moment-image').value = '';
            document.getElementById('image-preview').classList.add('hidden');
            document.getElementById('image-placeholder').classList.remove('hidden');
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
    lucide.createIcons();
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

function previewMomentImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            momentImageBase64 = e.target.result;
            const preview = document.getElementById('image-preview');
            preview.src = momentImageBase64;
            preview.classList.remove('hidden');
            document.getElementById('image-placeholder').classList.add('hidden');
        }
        reader.readAsDataURL(file);
    }
}

function addMoment() {
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
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            qrImageBase64 = e.target.result;
            const preview = document.getElementById('qr-preview-img');
            preview.src = qrImageBase64;
            preview.classList.remove('hidden');
            document.getElementById('qr-upload-placeholder').classList.add('hidden');
            const removeBtn = document.getElementById('remove-qr-btn');
            if (removeBtn) removeBtn.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
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
    const previewImg = document.getElementById('qr-preview-img');
    const placeholder = document.getElementById('qr-upload-placeholder');
    const uploadInput = document.getElementById('qr-upload-input');
    const removeBtn = document.getElementById('remove-qr-btn');
    
    if (uploadInput) uploadInput.value = '';
    
    if (currentUserObj) {
        upiInput.value = currentUserObj.upi || '';
        if (currentUserObj.qrImage) {
            qrImageBase64 = currentUserObj.qrImage;
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
    } else {
        upiInput.value = '';
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
    const upiValue = upiInput.value.trim();
    if (!upiValue) {
        alert("Please enter a UPI ID!");
        return;
    }
    
    if (usingFirebase) {
        const currentUser = firebase.auth().currentUser;
        if (!currentUser) return;
        const memberId = currentUser.uid;
        
        const updateData = { upi: upiValue };
        if (qrImageBase64) {
            updateData.qrImage = qrImageBase64;
        } else {
            updateData.qrImage = firebase.firestore.FieldValue.delete();
        }
        
        db.collection("groups").doc(CURRENT_GROUP).collection("members").doc(memberId).update(updateData).then(() => {
            document.getElementById('profile-upi').innerText = upiValue;
            closeModal('profile-qr-modal');
        }).catch(err => {
            alert("Error saving details: " + err.message);
        });
    } else {
        // Offline Local Simulator Mode
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData) {
            const member = groupData.members.find(m => m.name === CURRENT_USER);
            if (member) {
                member.upi = upiValue;
                if (qrImageBase64) {
                    member.qrImage = qrImageBase64;
                } else {
                    delete member.qrImage;
                }
                saveLocalDB(dbObj);
                syncLocalGroupData();
            }
        }
        document.getElementById('profile-upi').innerText = upiValue;
        closeModal('profile-qr-modal');
    }
}

function openQRModal(name) {
    const user = users.find(u => u.name === name);
    if (user) {
        document.getElementById('qr-name').innerText = user.name;
        document.getElementById('qr-upi').innerText = user.upi;
        document.getElementById('qr-avatar').src = user.avatar;
        
        const qrImageEl = document.getElementById('qr-modal-image');
        if (user.qrImage) {
            qrImageEl.src = user.qrImage;
        } else {
            const upiUrl = `upi://pay?pa=${encodeURIComponent(user.upi)}&pn=${encodeURIComponent(user.name)}&cu=INR`;
            qrImageEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUrl)}`;
        }
        
        openModal('qr-modal');
    }
}

function copyUPI() {
    const upiText = document.getElementById('qr-upi').innerText;
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

    firebase.auth().onAuthStateChanged((user) => {
        const loaderEl = document.getElementById('loader-view');
        if (user) {
            // Check if this was a manual sign-in click (isSigningIn) and has not been verified via OTP yet
            if (isSigningIn && !otpVerified) {
                const displayName = user.displayName || user.email.split('@')[0];
                sendEmailOTP(displayName, user.email, 'login', { name: displayName, email: user.email });
                
                // Hide loading screen, keep user on login page with OTP modal open
                loaderEl.classList.add('opacity-0');
                setTimeout(() => loaderEl.classList.add('hidden'), 400);
                return;
            }

            CURRENT_USER = user.displayName || user.email.split('@')[0];
            localStorage.setItem('gaytm_user', CURRENT_USER);
            localStorage.setItem('gaytm_user_email', user.email);
            const userNs = user.email.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
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
            removeUserItem('group');
            removeUserItem('group_name');
            
            // Clean dynamic UI lists
            users = [];
            expenses = [];
            moments = [];

            if (unsubscribeMembers) unsubscribeMembers();
            if (unsubscribeExpenses) unsubscribeExpenses();
            if (unsubscribeMoments) unsubscribeMoments();

            document.getElementById('main-app').classList.add('hidden');
            document.getElementById('login-view').classList.remove('hidden');
        }
        
        // Hide loader after loading has finished
        loaderEl.classList.add('opacity-0');
        setTimeout(() => loaderEl.classList.add('hidden'), 400);
    });
} else {
    // Offline Local Mode startup check
    const storedUser = localStorage.getItem('gaytm_user');
    const storedGroup = getUserItem('group');

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
    lucide.createIcons();
}

// Initialize theme on script run
(function() {
    const savedTheme = localStorage.getItem('gaytm_theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = savedTheme === 'dark' || (!savedTheme && systemPrefersDark);
    toggleDarkTheme(isDark);
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
    lucide.createIcons();
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
});
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
                        const groupName = gDoc.data().name || groupCode;
                        addToUserGroupsList(groupCode, groupName);

                        // Clear pending state if approved
                        if (getUserItem('pending_request_group') === groupCode) {
                            removeUserItem('pending_request_group');
                        }

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
        snapshot.forEach((doc) => {
            const groupDocRef = doc.ref.parent.parent;
            if (groupDocRef) {
                const groupCode = groupDocRef.id;
                if (!CURRENT_GROUP && !getUserItem('pending_request_group')) {
                    setUserItem('pending_request_group', groupCode);
                    initApp();
                }
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
        const payerObj = users.find(u => u.name.toLowerCase() === exp.paidBy.toLowerCase());
        if (!payerObj) return;
        const payer = payerObj.name;

        const splitWith = (exp.splitWith || []).map(member => {
            const memberObj = users.find(u => u.name.toLowerCase() === member.toLowerCase());
            return memberObj ? memberObj.name : null;
        }).filter(Boolean);

        if (splitWith.length === 0) return;

        const splitAmount = exp.amount / splitWith.length;

        splitWith.forEach(member => {
            if (member !== payer) {
                debts[member][payer] += splitAmount;
            }
        });
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

    expenseChart = new Chart(canvas, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 1,
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
                        label: function(context) {
                            return ` ₹${context.raw.toFixed(2)}`;
                        }
                    }
                }
            }
        }
    });
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
    lucide.createIcons();
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
        expRef.get().then((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            const comments = data.comments || [];
            comments.push(newComment);
            expRef.update({ comments }).then(() => {
                input.value = '';
            });
        });
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

function toggleLikeMoment(momentId) {
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

    const newComment = {
        user: CURRENT_USER,
        text: text,
        timestamp: new Date().toISOString()
    };

    if (usingFirebase) {
        const momentRef = db.collection("groups").doc(CURRENT_GROUP).collection("moments").doc(momentId);
        momentRef.get().then((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            const comments = data.comments || [];
            comments.push(newComment);
            momentRef.update({ comments }).then(() => {
                input.value = '';
            });
        });
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
    const defaultAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${CURRENT_USER}&backgroundColor=c7d2fe`;

    const previewImg = document.getElementById('avatar-preview-img');
    if (previewImg) {
        previewImg.src = currentUserObj?.avatar || defaultAvatar;
    }

    uploadedAvatarBase64 = currentUserObj?.avatar || null;
    openModal('profile-edit-modal');
}

function previewAvatarUploadImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            uploadedAvatarBase64 = e.target.result;
            const preview = document.getElementById('avatar-preview-img');
            if (preview) preview.src = uploadedAvatarBase64;
        }
        reader.readAsDataURL(file);
    }
}

function saveProfileDetails() {
    const newNameInput = document.getElementById('edit-display-name-input');
    const newName = newNameInput ? newNameInput.value.trim() : '';
    if (!newName) {
        alert('Please enter a valid display name.');
        return;
    }

    const defaultAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${newName}&backgroundColor=c7d2fe`;
    const avatarToSave = uploadedAvatarBase64 || defaultAvatar;
    const oldName = CURRENT_USER;

    if (usingFirebase && firebase.auth().currentUser) {
        const user = firebase.auth().currentUser;
        user.updateProfile({
            displayName: newName
        }).then(() => {
            if (CURRENT_GROUP) {
                db.collection('groups').doc(CURRENT_GROUP).collection('members').doc(user.uid).update({
                    name: newName,
                    avatar: avatarToSave
                }).catch(e => console.log("Failed updating member in Firestore:", e));
            }
            CURRENT_USER = newName;
            localStorage.setItem('gaytm_user', newName);
            initApp();
            closeModal('profile-edit-modal');
            alert('Profile updated successfully!');
        }).catch(err => {
            alert('Failed to update profile: ' + err.message);
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
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            expenseImageBase64 = e.target.result;
            const preview = document.getElementById('expense-image-preview');
            if (preview) {
                preview.src = expenseImageBase64;
                preview.classList.remove('hidden');
            }
            const placeholder = document.getElementById('expense-image-placeholder');
            if (placeholder) placeholder.classList.add('hidden');
        }
        reader.readAsDataURL(file);
    }
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

    const defaultAvatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(CURRENT_GROUP_NAME)}&backgroundColor=c7d2fe`;
    const avatarImg = document.getElementById('groups-avatar-img');
    const aboutText = document.getElementById('groups-about-text');

    if (usingFirebase) {
        db.collection("groups").doc(CURRENT_GROUP).get().then((doc) => {
            if (doc.exists) {
                const data = doc.data();
                if (avatarImg) avatarImg.src = data.avatar || defaultAvatar;
                if (aboutText) aboutText.innerText = data.about || "Welcome to our group! Share details, split bills, and enjoy.";
            }
        }).catch(() => {
            if (avatarImg) avatarImg.src = defaultAvatar;
        });
    } else {
        const dbObj = getLocalDB();
        const groupData = dbObj.groups[CURRENT_GROUP];
        if (groupData) {
            if (avatarImg) avatarImg.src = groupData.avatar || defaultAvatar;
            if (aboutText) aboutText.innerText = groupData.about || "Welcome to our group! Share details, split bills, and enjoy.";
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
    const file = event.target.files[0];
    if (!file || !CURRENT_GROUP) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const base64 = e.target.result;
        const avatarImg = document.getElementById('groups-avatar-img');
        if (avatarImg) avatarImg.src = base64;

        if (usingFirebase) {
            db.collection("groups").doc(CURRENT_GROUP).update({
                avatar: base64
            }).then(() => {
                alert("Group photo updated!");
            }).catch(err => {
                alert("Failed to update group photo: " + err.message);
            });
        } else {
            const dbObj = getLocalDB();
            if (dbObj.groups[CURRENT_GROUP]) {
                dbObj.groups[CURRENT_GROUP].avatar = base64;
                saveLocalDB(dbObj);
                alert("Group photo updated!");
            }
        }
    };
    reader.readAsDataURL(file);
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



