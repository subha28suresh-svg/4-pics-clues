import { initializeApp } from "firebase/app";
import { 
    getFirestore, 
    initializeFirestore, 
    persistentLocalCache,
    persistentMultipleTabManager,
    collection, 
    getDocs 
} from "firebase/firestore";

// ==========================================
// 1. FIREBASE CONFIGURATION
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyB_Wu763yWRJACyH8r_xhjAX7PoBdS2PCM",
  authDomain: "picclues.firebaseapp.com",
  projectId: "picclues",
  storageBucket: "picclues.firebasestorage.app",
  messagingSenderId: "139046945616",
  appId: "1:139046945616:web:b3b896a20c5824e4d4e255",
  measurementId: "G-8MKWTH5KG7"
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    })
});

// ==========================================
// AUDIO SUBSYSTEM WITH FALLBACKS
// ==========================================
const bgMusic = new Audio("https://ik.imagekit.io/AngLak/bg-music.mp3");
bgMusic.loop = true;
bgMusic.volume = 0.4; 

const sndBuzzer = new Audio("https://ik.imagekit.io/AngLak/buzzer.mp3");
const sndCheer = new Audio("https://ik.imagekit.io/AngLak/cheer.mp3");
const sndClick = new Audio("https://ik.imagekit.io/AngLak/click.mp3");

sndBuzzer.preload = "auto";
sndCheer.preload = "auto";
sndClick.preload = "auto";

let isMuted = localStorage.getItem('gameMuted') === 'true';

function playSound(audioObject) {
    if (isMuted) return; 
    audioObject.currentTime = 0;
    audioObject.play().catch(e => console.log("Sound play blocked:", e));
}

function syncMuteUI() {
    const muteBtn = document.getElementById('globalMuteBtn');
    if (!muteBtn) return;
    
    if (isMuted) {
        muteBtn.innerText = "🔇";
        muteBtn.classList.add('muted');
        bgMusic.pause();
    } else {
        muteBtn.innerText = "🔊";
        muteBtn.classList.remove('muted');
        if (document.getElementById('introLoadingView').style.display === 'none') {
            bgMusic.play().catch(err => console.log("Music auto-play waiting for focus:", err));
        }
    }
}

function toggleMute() {
    isMuted = !isMuted;
    localStorage.setItem('gameMuted', isMuted);
    syncMuteUI();
}

setTimeout(syncMuteUI, 100);

// ==========================================
// 2. GLOBAL ENGINE STATE
// ==========================================
let puzzleDatabase = { easy: [], medium: [], hard: [] };
let currentDifficulty = 'easy';
let currentPuzzleIndex = 0;
let currentAnswer = "";
let playerAnswer = [];
let coins = parseInt(localStorage.getItem('gameCoins')) || 200;
let levelProgress = JSON.parse(localStorage.getItem('gameProgress')) || {};
let consecutiveWrongCount = 0;
let hasClaimedDoubleCoins = false; 
let levelsCompletedCounter = 0;

['easy_0', 'medium_0', 'hard_0'].forEach(id => {
    if (!levelProgress[id]) levelProgress[id] = 'unlocked';
});

// Product IDs mapped for Google Play Console
const PRODUCT_STARTER = "coins_500";
const PRODUCT_CHEST = "coins_2500";
const PRODUCT_VAULT = "coins_10000";

// ==========================================
// 3. RATING SYSTEM & UI MANAGEMENT
// ==========================================
function updateRatingUI() {
    const hasRated = localStorage.getItem('hasRatedGame') === 'true';
    const menuBtn = document.getElementById('menuRatingBtn');
    const shopSection = document.getElementById('shopRatingSection');
    const level10Card = document.getElementById('level10RatingCard');

    if (hasRated) {
        if (menuBtn) menuBtn.style.display = 'none';
        if (shopSection) shopSection.style.display = 'none';
        if (level10Card) level10Card.style.display = 'none';
    } else {
        if (menuBtn) menuBtn.style.display = 'flex';
        if (shopSection) shopSection.style.display = 'block';
    }
}

function openRatingModal() {
    playSound(sndClick);
    const hasRated = localStorage.getItem('hasRatedGame') === 'true';
    if (hasRated) return;

    const storeUrl = "https://play.google.com/store/apps/details?id=com.vividmind.fourpicsclues";
    window.open(storeUrl, "_system");

    coins += 100;
    localStorage.setItem('gameCoins', coins);
    localStorage.setItem('hasRatedGame', 'true');
    updateCoinUI();
    updateRatingUI();
    alert("Thank you for rating 4 Pics Clues! You earned +100 Coins! 🪙");
}

// ==========================================
// 4. CORDOVA PURCHASE PLUGIN INITIALIZATION
// ==========================================
function initInAppPurchases() {
    if (typeof C2F === "undefined" && typeof store === "undefined") {
        console.warn("Cordova Purchase plugin not found. Defaulting to fallback mode.");
        return;
    }

    const storeEngine = window.store || window.C2F;
    if (!storeEngine) return;

    storeEngine.register([
        { id: PRODUCT_STARTER, type: storeEngine.CONSUMABLE },
        { id: PRODUCT_CHEST, type: storeEngine.CONSUMABLE },
        { id: PRODUCT_VAULT, type: storeEngine.CONSUMABLE }
    ]);

    storeEngine.when(PRODUCT_STARTER).approved((p) => grantCoins(500, p));
    storeEngine.when(PRODUCT_CHEST).approved((p) => grantCoins(2500, p));
    storeEngine.when(PRODUCT_VAULT).approved((p) => grantCoins(10000, p));

    storeEngine.when("product").updated((p) => {
        if (p.id === PRODUCT_STARTER && p.pricing) document.getElementById('priceStarter').innerText = p.pricing;
        if (p.id === PRODUCT_CHEST && p.pricing) document.getElementById('priceChest').innerText = p.pricing;
        if (p.id === PRODUCT_VAULT && p.pricing) document.getElementById('priceVault').innerText = p.pricing;
    });

    storeEngine.refresh();
}

function grantCoins(amount, product) {
    coins += amount;
    localStorage.setItem('gameCoins', coins);
    updateCoinUI();
    if (product && typeof product.finish === "function") {
        product.finish();
    }
    closeShop();
}

function triggerNativePurchase(productId, fallbackCoins) {
    const storeEngine = window.store || window.C2F;
    if (storeEngine && typeof storeEngine.order === "function") {
        storeEngine.order(productId);
    } else {
        grantCoins(fallbackCoins, null);
    }
}

// ==========================================
// 5. INTRO LOADER CONTROLLER
// ==========================================
function startIntroProgressBar() {
    const progressFill = document.getElementById('introProgressBarFill');
    const statusText = document.getElementById('loaderStatusText');
    
    let duration = 5000; 
    let intervalTime = 50; 
    let currentStep = 0;
    let totalSteps = duration / intervalTime;

    loadPuzzlesFromFirestore();

    let loadingTimer = setInterval(() => {
        currentStep++;
        let percentage = (currentStep / totalSteps) * 100;
        
        if (progressFill) progressFill.style.width = `${percentage}%`;

        if (percentage < 30) {
            statusText.innerText = "Game is loading...";
        } else if (percentage >= 30 && percentage < 65) {
            statusText.innerText = "Connecting to database...";
        } else if (percentage >= 65 && percentage < 90) {
            statusText.innerText = "Syncing local progress settings...";
        } else if (percentage >= 90) {
            statusText.innerText = "Ready to play!";
        }

        if (currentStep >= totalSteps) {
            clearInterval(loadingTimer);
            transitionToWelcomePage();
        }
    }, intervalTime);
}

function transitionToWelcomePage() {
    document.getElementById('introLoadingView').style.display = 'none';
    document.getElementById('splashView').style.display = 'flex';
    
    if (!isMuted) {
        bgMusic.play().catch(err => console.log("Music waiting for interaction:", err));
    }

    const welcomeVid = document.getElementById('welcomeGrandpaVideo');
    if (welcomeVid) {
        welcomeVid.play().catch(e => console.log("Video interaction pending focus:", e));
    }
}

updateCoinUI();
startIntroProgressBar();

// ==========================================
// 6. FIRESTORE CORES
// ==========================================
async function loadPuzzlesFromFirestore() {
    try {
        puzzleDatabase.easy = [];
        puzzleDatabase.medium = [];
        puzzleDatabase.hard = [];

        const puzzlesCollectionRef = collection(db, "puzzles");
        const querySnapshot = await getDocs(puzzlesCollectionRef);

        if (querySnapshot.empty) {
            console.warn("Firestore 'puzzles' collection returned empty.");
            return;
        }

        querySnapshot.forEach((doc) => {
            const puzzleData = doc.data();
            const difficultyTag = puzzleData.difficulty ? puzzleData.difficulty.toLowerCase() : 'easy';

            const puzzleObject = {
                answer: puzzleData.answer ? puzzleData.answer.toUpperCase().trim() : "",
                images: puzzleData.images || []
            };

            if (puzzleDatabase[difficultyTag] && puzzleObject.answer && puzzleObject.images.length === 4) {
                puzzleDatabase[difficultyTag].push(puzzleObject);
            }
        });

    } catch (error) {
        console.error("Database connection restricted: ", error.message);
    }
}

function updateCoinUI() {
    const elements = document.querySelectorAll('.coinCount');
    elements.forEach(el => { el.innerText = coins; });
}

// ==========================================
// 7. NAVIGATION VIEW CONTROLLERS
// ==========================================
function dismissSplashScreen() {
    playSound(sndClick);
    
    const docElem = document.documentElement;
    if (docElem.requestFullscreen) {
        docElem.requestFullscreen().catch(e => console.log("Fullscreen defer:", e));
    }

    if (!isMuted) {
        bgMusic.play().catch(err => console.log("Music defer:", err));
    }

    document.getElementById('splashView').style.display = 'none';
    document.getElementById('globalHeaderBar').style.display = 'flex'; 
    document.getElementById('globalBackBtn').style.visibility = 'hidden'; 
    document.getElementById('menuView').style.display = 'flex';
    updateRatingUI();
    renderLevelGrid();
}

function switchTab(difficulty) {
    playSound(sndClick);
    currentDifficulty = difficulty;
    document.getElementById('easyTab').classList.remove('active');
    document.getElementById('mediumTab').classList.remove('active');
    document.getElementById('hardTab').classList.remove('active');
    document.getElementById(`${difficulty}Tab`).classList.add('active');
    renderLevelGrid();
}

function renderLevelGrid() {
    const grid = document.getElementById('levelGrid');
    if (!grid) return;
    grid.innerHTML = ""; 

    const puzzles = puzzleDatabase[currentDifficulty] || [];

    puzzles.forEach((puzzle, index) => {
        const id = `${currentDifficulty}_${index}`;
        let status = levelProgress[id] || 'locked';

        if (index > 0) {
            const prevId = `${currentDifficulty}_${index - 1}`;
            if (levelProgress[prevId] === 'completed' && status === 'locked') {
                status = 'unlocked';
                levelProgress[id] = 'unlocked';
                localStorage.setItem('gameProgress', JSON.stringify(levelProgress));
            }
        }

        const card = document.createElement('div');
        card.className = `level-card ${status}`;
        card.innerHTML = `<div>${index + 1}</div>`;

        if (status !== 'locked') {
            card.addEventListener('click', () => {
                playSound(sndClick);
                startPuzzle(index);
            });
        }
        grid.appendChild(card);
    });
}

function showMenu() {
    playSound(sndClick);
    document.getElementById('splashView').style.display = 'none';
    document.getElementById('gameplayView').style.display = 'none';
    document.getElementById('successView').style.display = 'none';
    document.getElementById('wrongAnswerView').style.display = 'none';
    document.getElementById('victoryConfetti').style.display = 'none';
    
    document.getElementById('globalHeaderBar').style.display = 'flex';
    document.getElementById('globalBackBtn').style.visibility = 'hidden'; 
    
    document.getElementById('menuView').style.display = 'flex';
    updateRatingUI();
    renderLevelGrid(); 
}

// ==========================================
// 8. CORE GAMEPLAY INTERACTIVE MECHANICS
// ==========================================
function startPuzzle(index) {
    currentPuzzleIndex = index;
    consecutiveWrongCount = 0; 
    hasClaimedDoubleCoins = false; 

    const puzzle = puzzleDatabase[currentDifficulty][index];
    currentAnswer = puzzle.answer;
    playerAnswer = new Array(currentAnswer.length).fill("");

    document.getElementById('menuView').style.display = 'none';
    document.getElementById('successView').style.display = 'none';
    document.getElementById('wrongAnswerView').style.display = 'none';
    document.getElementById('victoryConfetti').style.display = 'none';
    
    document.getElementById('globalHeaderBar').style.display = 'flex';
    document.getElementById('globalBackBtn').style.visibility = 'visible'; 

    document.getElementById('gameplayView').style.display = 'flex';
    setupPuzzle(puzzle);
}

function setupPuzzle(puzzle) {
    document.getElementById('levelTitle').innerText = `${currentDifficulty.toUpperCase()} - LEVEL ${currentPuzzleIndex + 1}`;
    document.getElementById('answerContainer').innerHTML = "";
    document.getElementById('lettersContainer').innerHTML = "";

    for (let i = 0; i < 4; i++) {
        document.getElementById(`img${i}`).src = puzzle.images[i];
    }

    for (let i = 0; i < currentAnswer.length; i++) {
        const slot = document.createElement('div');
        slot.className = 'letter-slot';
        slot.id = `slot-${i}`;
        slot.addEventListener('click', () => {
            playSound(sndClick);
            removeLetter(i);
        });
        document.getElementById('answerContainer').appendChild(slot);
    }

    let keyboardArray = currentAnswer.split("");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    while (keyboardArray.length < 12) {
        let randomLetter = alphabet[Math.floor(Math.random() * alphabet.length)];
        keyboardArray.push(randomLetter);
    }
    keyboardArray.sort(() => Math.random() - 0.5);

    keyboardArray.forEach((letter, index) => {
        const btn = document.createElement('button');
        btn.className = 'letter-btn';
        btn.id = `key-${index}`;
        btn.innerText = letter;
        btn.addEventListener('click', () => {
            playSound(sndClick);
            selectLetter(letter, index);
        });
        document.getElementById('lettersContainer').appendChild(btn);
    });

    document.getElementById('hintBtn').style.display = 'block';
    document.getElementById('removeLettersBtn').style.display = 'block';
}

function selectLetter(letter, keyIndex) {
    const emptyIndex = playerAnswer.indexOf("");
    if (emptyIndex === -1) return; 

    playerAnswer[emptyIndex] = letter;
    const slot = document.getElementById(`slot-${emptyIndex}`);
    slot.innerText = letter;
    slot.dataset.originKey = keyIndex;
    document.getElementById(`key-${keyIndex}`).disabled = true;

    if (!playerAnswer.includes("")) { checkResult(); }
}

function removeLetter(slotIndex) {
    const slot = document.getElementById(`slot-${slotIndex}`);
    if (slot.classList.contains('hint-locked') || playerAnswer[slotIndex] === "") return;

    const keyIndex = slot.dataset.originKey;
    if (keyIndex !== undefined) {
        const keyBtn = document.getElementById(`key-${keyIndex}`);
        if (keyBtn) keyBtn.disabled = false;
    }

    playerAnswer[slotIndex] = "";
    slot.innerText = "";
    delete slot.dataset.originKey;
}

function clearCurrentGuess() {
    for (let i = 0; i < currentAnswer.length; i++) {
        removeLetter(i);
    }
}

function pauseActiveMedia() {
    ['welcomeGrandpaVideo', 'successGrandpaVid', 'wrongGrandpaVid'].forEach(id => {
        const vid = document.getElementById(id);
        if (vid && !vid.paused) vid.pause();
    });
}

function resumeActiveMedia() {
    if (document.getElementById('splashView').style.display === 'flex') {
        const welcomeVid = document.getElementById('welcomeGrandpaVideo');
        if (welcomeVid) welcomeVid.play().catch(e => console.log(e));
    } else if (document.getElementById('successView').style.display === 'flex') {
        const successVid = document.getElementById('successGrandpaVid');
        if (successVid) successVid.play().catch(e => console.log(e));
    } else if (document.getElementById('wrongAnswerView').style.display === 'flex') {
        const wrongVid = document.getElementById('wrongGrandpaVid');
        if (wrongVid) wrongVid.play().catch(e => console.log(e));
    }
}

function checkResult() {
    const guess = playerAnswer.join("");
    if (guess === currentAnswer) {
        consecutiveWrongCount = 0;
        playSound(sndCheer);
        
        const id = `${currentDifficulty}_${currentPuzzleIndex}`;
        const isFirstTimeClear = (levelProgress[id] !== 'completed'); 

        levelProgress[id] = 'completed';
        localStorage.setItem('gameProgress', JSON.stringify(levelProgress));

        document.getElementById('gameplayView').style.display = 'none';
        document.getElementById('globalHeaderBar').style.display = 'none'; 
        
        document.getElementById('victoryConfetti').style.display = 'block';
        document.getElementById('successView').style.display = 'flex';
        
        const level10Card = document.getElementById('level10RatingCard');
        const hasRated = localStorage.getItem('hasRatedGame') === 'true';
        if (currentPuzzleIndex === 9 && !hasRated) {
            level10Card.style.display = 'block';
        } else {
            level10Card.style.display = 'none';
        }

        const successCoinBadge = document.getElementById('successCoinBadge');
        const adPromoText = document.getElementById('adPromoText');
        const doubleBtn = document.getElementById('doubleCoinsBtn');
        const nextBtn = document.getElementById('nextBtn');

        if (isFirstTimeClear) {
            coins += 20;
            localStorage.setItem('gameCoins', coins);
            updateCoinUI();

            successCoinBadge.innerText = '🪙 +20 COINS';
            adPromoText.innerText = '📺 Watch an ad to double your coins!';
            doubleBtn.innerText = 'Watch Ad (+20🪙)';
        } else {
            successCoinBadge.innerText = '🪙 LEVEL REPLAYED';
            adPromoText.innerText = '📺 Watch an ad to gain bonus coins!';
            doubleBtn.innerText = 'Watch Ad (+40🪙)';
        }
        
        adPromoText.style.display = 'block';
        doubleBtn.style.display = 'block';
        doubleBtn.removeAttribute('disabled');

        nextBtn.innerText = 'No thanks, next level ➡️'; 
        nextBtn.style.display = 'none'; 

        setTimeout(() => {
            if (!hasClaimedDoubleCoins) {
                nextBtn.style.display = 'block';
            }
        }, 2500);

        doubleBtn.dataset.wasFirstTime = isFirstTimeClear ? "true" : "false";

        const successVid = document.getElementById('successGrandpaVid');
        if (successVid) {
            successVid.load();
            successVid.play().catch(e => console.log("Autoplay context locked:", e));
        }

    } else {
        consecutiveWrongCount++;
        if (consecutiveWrongCount >= 5) {
            consecutiveWrongCount = 0; 
            playSound(sndBuzzer);
            
            document.getElementById('gameplayView').style.display = 'none';
            document.getElementById('globalHeaderBar').style.display = 'none'; 
            document.getElementById('wrongAnswerView').style.display = 'flex';
            
            const wrongVid = document.getElementById('wrongGrandpaVid');
            if (wrongVid) {
                wrongVid.load();
                wrongVid.play().catch(e => console.log("Autoplay lock:", e));
            }
            clearCurrentGuess();
        } else {
            playSound(sndBuzzer);
            const slots = document.querySelectorAll('.letter-slot');
            slots.forEach(s => {
                s.style.borderColor = "#ff4757";
                setTimeout(() => { s.style.borderColor = "rgba(0, 255, 135, 0.3)"; }, 600);
            });
            clearCurrentGuess();
        }
    }
}

function dismissWrongScreen() {
    playSound(sndClick);
    document.getElementById('wrongAnswerView').style.display = 'none';
    document.getElementById('globalHeaderBar').style.display = 'flex';
    document.getElementById('globalBackBtn').style.visibility = 'visible';
    document.getElementById('gameplayView').style.display = 'flex';
}

// ==========================================
// 9. SHOP AND HINTS BALANCES
// ==========================================
function useHint() {
    playSound(sndClick);
    if (coins < 50) { openShop(); return; }

    let availableIndexes = [];
    for (let i = 0; i < currentAnswer.length; i++) {
        const slot = document.getElementById(`slot-${i}`);
        if (slot && !slot.classList.contains('hint-locked')) {
            availableIndexes.push(i);
        }
    }

    if (availableIndexes.length === 0) return;

    let randomIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
    let correctLetter = currentAnswer[randomIndex];

    coins -= 50;
    localStorage.setItem('gameCoins', coins);
    updateCoinUI();

    const existingSlot = document.getElementById(`slot-${randomIndex}`);
    if (existingSlot && existingSlot.dataset.originKey !== undefined) {
        const oldKeyBtn = document.getElementById(`key-${existingSlot.dataset.originKey}`);
        if (oldKeyBtn) oldKeyBtn.disabled = false;
        delete existingSlot.dataset.originKey;
    }

    playerAnswer[randomIndex] = correctLetter;
    const slot = document.getElementById(`slot-${randomIndex}`);
    slot.innerText = correctLetter;
    slot.classList.add('hint-locked');

    const buttons = document.querySelectorAll('.letter-btn');
    for (let btn of buttons) {
        if (btn.innerText === correctLetter && !btn.disabled && !btn.classList.contains('bomb-deleted')) {
            btn.disabled = true;
            break;
        }
    }

    if (!playerAnswer.includes("")) checkResult();
}

function useRemoveLettersHint() {
  playSound(sndClick);
  if (coins < 30) { openShop(); return; }
  
  const buttons = Array.from(document.querySelectorAll('.letter-btn'));
  let wrongButtons = buttons.filter(btn => {
      let letter = btn.innerText.toUpperCase();
      return !currentAnswer.includes(letter) && !btn.classList.contains('bomb-deleted') && !btn.disabled;
  });

  if (wrongButtons.length === 0) return;

  coins -= 30;
  localStorage.setItem('gameCoins', coins);
  updateCoinUI();

  wrongButtons.sort(() => Math.random() - 0.5);
  let itemToDelete = wrongButtons[0]; 
  
  itemToDelete.classList.add('bomb-deleted');
  itemToDelete.disabled = true;
}

function openShop() { 
    playSound(sndClick); 
    updateRatingUI();
    document.getElementById('shopModal').style.display = 'flex'; 
}
function closeShop() { playSound(sndClick); document.getElementById('shopModal').style.display = 'none'; }

const gameEngine = {
    toggleMute,
    useHint,
    useRemoveLettersHint,
    dismissWrongScreen,
    
    loadNextPuzzle: function() {
        playSound(sndClick);
        document.getElementById('victoryConfetti').style.display = 'none';
        levelsCompletedCounter++;
        
        if (levelsCompletedCounter >= 5) {
            levelsCompletedCounter = 0; 
            document.getElementById('successView').style.display = 'none';
            document.getElementById('globalHeaderBar').style.display = 'none';
            
            const statusText = document.getElementById('loaderStatusText');
            const progressFill = document.getElementById('introProgressBarFill');
            document.getElementById('introLoadingView').style.display = 'flex';
            
            let adCountdown = 5;
            statusText.innerText = `⏳ Loading Studio Sponsor Ad... (${adCountdown}s)`;
            if (progressFill) progressFill.style.width = '0%';
            
            let adFillPercentage = 0;
            const adInterval = setInterval(() => {
                adFillPercentage += 20;
                adCountdown = Math.max(0, adCountdown - 1);
                if (progressFill) progressFill.style.width = `${adFillPercentage}%`;
                statusText.innerText = `🎬 Streaming Sponsor Video... (${adCountdown}s)`;
                
                if (adFillPercentage >= 100) {
                    clearInterval(adInterval);
                    document.getElementById('introLoadingView').style.display = 'none';
                    document.getElementById('globalHeaderBar').style.display = 'flex';
                    gameEngine.executeNextPuzzleLoading();
                }
            }, 1000);
        } else {
            gameEngine.executeNextPuzzleLoading();
        }
    },

    executeNextPuzzleLoading: function() {
        const currentList = puzzleDatabase[currentDifficulty] || [];
        let nextIndex = currentPuzzleIndex + 1;
        if (nextIndex < currentList.length) {
            startPuzzle(nextIndex);
        } else {
            alert("Congratulations! You completed all available puzzles.");
            showMenu();
        }
    },

    watchDoubleCoinsAd: function() {
        if (hasClaimedDoubleCoins) return;
        playSound(sndClick);
        
        const doubleBtn = document.getElementById('doubleCoinsBtn');
        const isFirstTimeClear = (doubleBtn.dataset.wasFirstTime === "true");
        doubleBtn.setAttribute('disabled', 'true');
        
        let countdown = 3;
        doubleBtn.innerText = `🎬 Streaming Ad... (${countdown}s)`;
        
        const adTimer = setInterval(() => {
            countdown--;
            if (countdown > 0) {
                doubleBtn.innerText = `🎬 Streaming Ad... (${countdown}s)`;
            } else {
                clearInterval(adTimer);
                hasClaimedDoubleCoins = true;
                
                if (isFirstTimeClear) {
                    coins += 20; 
                    document.getElementById('successCoinBadge').innerText = '🪙 +40 COINS (DOUBLED!)';
                } else {
                    coins += 40; 
                    document.getElementById('successCoinBadge').innerText = '🪙 +40 COINS CLAIMED!';
                }
                
                localStorage.setItem('gameCoins', coins);
                updateCoinUI();

                document.getElementById('adPromoText').style.display = 'none';
                doubleBtn.style.display = 'none';
                
                const nextBtn = document.getElementById('nextBtn');
                nextBtn.innerText = 'Next level ➡️';
                nextBtn.style.display = 'block';
            }
        }, 1000);
    },
    simulateRewardedAd: function() { coins += 50; localStorage.setItem('gameCoins', coins); updateCoinUI(); closeShop(); }
};

// ==========================================
// COMPLIANCE BINDINGS & NATIVE EMULATIONS
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('globalBackBtn').addEventListener('click', showMenu);
    document.getElementById('globalMuteBtn').addEventListener('click', gameEngine.toggleMute);
    document.getElementById('headerOpenShopBtn').addEventListener('click', openShop);
    document.getElementById('splashPlayBtn').addEventListener('click', dismissSplashScreen);
    
    document.getElementById('menuRatingBtn').addEventListener('click', openRatingModal);
    document.getElementById('shopRatingRow').addEventListener('click', openRatingModal);
    document.getElementById('level10RateBtn').addEventListener('click', openRatingModal);

    document.getElementById('easyTab').addEventListener('click', () => switchTab('easy'));
    document.getElementById('mediumTab').addEventListener('click', () => switchTab('medium'));
    document.getElementById('hardTab').addEventListener('click', () => switchTab('hard'));
    
    document.getElementById('hintBtn').addEventListener('click', gameEngine.useHint);
    document.getElementById('removeLettersBtn').addEventListener('click', gameEngine.useRemoveLettersHint);
    
    document.getElementById('doubleCoinsBtn').addEventListener('click', gameEngine.watchDoubleCoinsAd);
    document.getElementById('nextBtn').addEventListener('click', gameEngine.loadNextPuzzle);
    document.getElementById('tryAgainBtn').addEventListener('click', gameEngine.dismissWrongScreen);
    
    document.getElementById('shopCloseBtn').addEventListener('click', closeShop);
    document.getElementById('shopRewardAdBtn').addEventListener('click', gameEngine.simulateRewardedAd);
    
    document.getElementById('shopPackStarterBtn').addEventListener('click', () => triggerNativePurchase(PRODUCT_STARTER, 500));
    document.getElementById('shopPackChestBtn').addEventListener('click', () => triggerNativePurchase(PRODUCT_CHEST, 2500));
    document.getElementById('shopPackVaultBtn').addEventListener('click', () => triggerNativePurchase(PRODUCT_VAULT, 10000));
    
    document.addEventListener("deviceready", () => {
        initInAppPurchases();
    }, false);

    document.addEventListener("pause", () => {
        bgMusic.pause();
        pauseActiveMedia();
    }, false);

    document.addEventListener("resume", () => {
        if (!isMuted && document.getElementById('introLoadingView').style.display === 'none') {
            bgMusic.play().catch(err => console.log("Audio resume block:", err));
        }
        resumeActiveMedia();
    }, false);

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            bgMusic.pause();
            pauseActiveMedia();
        } else {
            if (!isMuted && document.getElementById('introLoadingView').style.display === 'none') {
                bgMusic.play().catch(err => console.log("Visibility chain block:", err));
            }
            resumeActiveMedia();
        }
    });
});