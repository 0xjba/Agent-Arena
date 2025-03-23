/**
 * TEN Network One Card Poker Test with Keeper Service
 * 
 * This test deploys the OneCard contract to TEN, runs the keeper service,
 * and simulates a full poker game with multiple players.
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
require("dotenv").config();

// Configure logging
const logPath = path.join(__dirname, "one-card-poker-test.txt");
let logStream = fs.createWriteStream(logPath, { flags: "a" });

function log(message) {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] ${message}\n`;
  logStream.write(formattedMessage);
  console.log(message);
}

// Card helper functions
function getCardValueName(value) {
  if (value >= 2 && value <= 10) return value.toString();
  if (value === 11) return "Jack";
  if (value === 12) return "Queen";
  if (value === 13) return "King";
  if (value === 14) return "Ace";
  return "Unknown";
}

function getCardSuitName(suit) {
  const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
  return suits[suit] || "Unknown";
}

function formatCard(value, suit) {
  return `${getCardValueName(value)} of ${getCardSuitName(suit)}`;
}

// GameState enum mapping from PokerGameLibrary
const GameState = {
  0: "PRE_GAME",
  1: "PEEK_PHASE",
  2: "BETTING",
  3: "SHOWDOWN",
  4: "ENDED"
};

// Function to set up wallets from .env file
async function setupWallets(provider) {
  const wallets = [];
  
  // Check for required environment variables
  if (!process.env.OWNER_PRIVATE_KEY) {
    throw new Error("OWNER_PRIVATE_KEY is required in .env file");
  }
  
  // Owner wallet
  const ownerWallet = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY, provider);
  wallets.push(ownerWallet);
  
  // Player wallets
  for (let i = 1; i <= 5; i++) {
    const privateKeyVar = `PLAYER${i}_PRIVATE_KEY`;
    if (!process.env[privateKeyVar]) {
      throw new Error(`${privateKeyVar} is required in .env file`);
    }
    const playerWallet = new ethers.Wallet(process.env[privateKeyVar], provider);
    wallets.push(playerWallet);
  }
  
  return wallets;
}

// Start keeper service as a child process
function startKeeperService(contractAddress) {
  return new Promise((resolve, reject) => {
    const keeper = spawn('node', ['js-keeper/keeper-service.js', contractAddress], {
      env: process.env,
      stdio: 'pipe'
    });
    
    keeper.stdout.on('data', (data) => {
      log(`[KEEPER] ${data.toString().trim()}`);
    });
    
    keeper.stderr.on('data', (data) => {
      log(`[KEEPER ERROR] ${data.toString().trim()}`);
    });
    
    // Wait a moment for the keeper to start
    setTimeout(() => {
      log("[TEST] Keeper service started");
      resolve(keeper);
    }, 2000);
    
    keeper.on('error', (err) => {
      log(`[KEEPER] Failed to start: ${err.message}`);
      reject(err);
    });
  });
}

describe("TEN Network One Card Poker with Keeper Test", function() {
  // Increase timeout for network interactions
  this.timeout(600000); // 10 minutes

  let cardLibrary;
  let gameLibrary;
  let pokerContract;
  let owner;
  let keeper;
  let players = [];
  let gameId;
  let playerCards = {};
  let keeperProcess;
  
  // Transaction options with higher gas settings
  const txOptions = {
    gasLimit: 2000000 // Increased for regular transactions
  };

  const highGasTxOptions = {
    gasLimit: 5000000 // Increased for complex operations
  };

  const veryHighGasTxOptions = {
    gasLimit: 15000000 // Significantly increased for very complex operations
  };

  const extremeGasTxOptions = {
    gasLimit: 30000000 // For the most gas-intensive operations like contract deployment
  };

  before(async function() {
    log("\n===== SETTING UP TEST ENVIRONMENT =====");
    
    // Set up wallets from .env
    const provider = ethers.provider;
    const wallets = await setupWallets(provider);
    
    // First wallet is owner/keeper
    owner = wallets[0];
    keeper = owner;
    
    // Player wallets (next 5)
    players = wallets.slice(1, 6);
    
    log("Wallet setup complete.");
    log(`Owner/Keeper address: ${owner.address}`);
    players.forEach((player, index) => {
      log(`Player ${index + 1} address: ${player.address}`);
    });
    
    // Check wallet balances
    log("\n----- CHECKING WALLET BALANCES -----");
    for (const wallet of [owner, ...players]) {
      const balance = await wallet.getBalance();
      const ethBalance = ethers.utils.formatEther(balance);
      log(`Address ${wallet.address} has ${ethBalance} ETH`);
      
      // Warn if balance is too low
      if (parseFloat(ethBalance) < 0.01) {
        log(`WARNING: Address ${wallet.address} has low balance. Please fund with ETH.`);
      }
    }
    
    // Deploy contracts
    log("\n----- DEPLOYING CONTRACTS -----");
    
    // First, deploy CardLibrary
    log("Deploying CardLibrary...");
    const CardLibraryFactory = await ethers.getContractFactory("contracts/vanilla/PokerCardLibrary.sol:CardLibrary", {
      signer: owner
    });
    cardLibrary = await CardLibraryFactory.deploy();
    await cardLibrary.deployed();
    log(`CardLibrary deployed at: ${cardLibrary.address}`);

    // Next, deploy GameLibrary
    log("Deploying GameLibrary...");
    const GameLibraryFactory = await ethers.getContractFactory("contracts/vanilla/PokerGameLibrary.sol:GameLibrary", {
      signer: owner
    });
    gameLibrary = await GameLibraryFactory.deploy();
    await gameLibrary.deployed();
    log(`GameLibrary deployed at: ${gameLibrary.address}`);

    // Deploy main contract
    log("Deploying OneCard main contract...");
    const PokerFactory = await ethers.getContractFactory("contracts/vanilla/OneCard.sol:OneCard", {
      signer: owner
    });
    pokerContract = await PokerFactory.deploy();
    await pokerContract.deployed();
    log(`OneCard contract deployed at: ${pokerContract.address}`);
    
    // Start the keeper service with the contract address
    log("Starting keeper service...");
    keeperProcess = await startKeeperService(pokerContract.address);
  });
  
  after(async function() {
    // Clean up keeper process if it's running
    if (keeperProcess) {
      log("Stopping keeper service...");
      keeperProcess.kill();
    }
    
    // Close the log file
    logStream.end();
  });
  
  it("Should play a complete game of One Card Poker with the keeper service", async function() {
    log("\n===== STARTING ONE CARD POKER WITH KEEPER TEST =====");
    
    // ===== GAME SETUP PHASE =====
    log("\n----- GAME CREATION -----");

    // Player 1 creates a game
    const gameCreator = players[0];
    log(`Player 1 (${gameCreator.address}) creating a game`);
    const createTx = await pokerContract.connect(gameCreator).createGame(highGasTxOptions);
    const createReceipt = await createTx.wait();
    
    // Extract gameId from the event logs
    const gameCreatedEvent = createReceipt.events.find(e => e.event === "GameCreated");
    gameId = gameCreatedEvent.args.gameId.toNumber();
    log(`Created Game with ID: ${gameId}`);
    
    // ===== PLAYER JOINING PHASE =====
    log("\n----- PLAYERS JOINING GAME -----");
    for (let i = 1; i < 5; i++) {  // Players 2, 3, 4, 5 need to join (player 1 is creator)
      const player = players[i];
      const joinTx = await pokerContract.connect(player).joinGame(gameId, txOptions);
      const joinReceipt = await joinTx.wait();
      log(`Player ${i+1} (${player.address}) joined the game`);
    }
    
    // Verify game info before starting
    log("\n----- VERIFYING GAME INFO BEFORE START -----");
    const gameInfo = await pokerContract.getGameInfo(gameId);
    log(`Game state: ${GameState[gameInfo.state]}`);
    log(`Player count: ${gameInfo.playerCount.toString()}`);
    log(`Active count: ${gameInfo.activeCount.toString()}`);
    log(`Creator: ${gameInfo.creator}`);
    
    // Store initial chip balances
    const initialChipBalances = {};
    
    // ===== SETUP EVENT LISTENERS =====
    log("\n----- SETTING UP EVENT LISTENERS -----");
    
    // Game state events
    pokerContract.on("PeekPhaseStarted", (gameIdEvent) => {
      if (gameIdEvent.toString() === gameId.toString()) {
        log(`[EVENT] Peek phase started for game ${gameId}`);
      }
    });
    
    pokerContract.on("BettingPhaseStarted", (gameIdEvent) => {
      if (gameIdEvent.toString() === gameId.toString()) {
        log(`[EVENT] Betting phase started for game ${gameId}`);
      }
    });
    
    pokerContract.on("ShowdownStarted", (gameIdEvent) => {
      if (gameIdEvent.toString() === gameId.toString()) {
        log(`[EVENT] Showdown started for game ${gameId}`);
      }
    });
    
    // Card events
    pokerContract.on("CardDealt", async (gameIdEvent, player) => {
      if (gameIdEvent.toString() === gameId.toString()) {
        // Match player to player number for easier identification
        const playerIndex = players.findIndex(p => p.address.toLowerCase() === player.toLowerCase());
        if (playerIndex !== -1) {
          log(`[EVENT] Card dealt to Player ${playerIndex + 1} (${player})`);
        } else {
          log(`[EVENT] Card dealt to player: ${player}`);
        }
      }
    });
    
    pokerContract.on("PlayerPeeked", async (gameIdEvent, player) => {
      if (gameIdEvent.toString() === gameId.toString()) {
        // Match player to player number for easier identification
        const playerIndex = players.findIndex(p => p.address.toLowerCase() === player.toLowerCase());
        if (playerIndex !== -1) {
          log(`[EVENT] Player ${playerIndex + 1} (${player}) has peeked at their card`);
        } else {
          log(`[EVENT] Player ${player} has peeked at their card`);
        }
      }
    });
    
    pokerContract.on("CardSwapped", async (gameIdEvent, player) => {
      if (gameIdEvent.toString() === gameId.toString()) {
        // Match player to player number for easier identification
        const playerIndex = players.findIndex(p => p.address.toLowerCase() === player.toLowerCase());
        if (playerIndex !== -1) {
          log(`[EVENT] Player ${playerIndex + 1} (${player}) swapped their card (new card not revealed)`);
        } else {
          log(`[EVENT] Player ${player} swapped their card (new card not revealed)`);
        }
      }
    });
    
    // Private card events (only for the specific player)
    pokerContract.on("CardPeeked", async (player, value, suit) => {
      const cardString = formatCard(Number(value), Number(suit));
      playerCards[player] = { value, suit, cardString };
      
      // Match player to player number for easier identification
      const playerIndex = players.findIndex(p => p.address.toLowerCase() === player.toLowerCase());
      if (playerIndex !== -1) {
        log(`[PRIVATE] Player ${playerIndex + 1} (${player}) card: ${cardString}`);
      } else {
        log(`[PRIVATE] Card for ${player}: ${cardString}`);
      }
    });
    
    // Player action events
    pokerContract.on("PlayerAction", async (gameIdEvent, player, action, amount) => {
      if (gameIdEvent.toString() === gameId.toString()) {
        // Match player to player number for easier identification
        const playerIndex = players.findIndex(p => p.address.toLowerCase() === player.toLowerCase());
        if (playerIndex !== -1) {
          log(`[ACTION] Player ${playerIndex + 1} (${player}) ${action} with amount ${amount}`);
        } else {
          log(`[ACTION] ${player} ${action} with amount ${amount}`);
        }
      }
    });
    
    // ===== GAME START PHASE =====
    log("\n----- STARTING THE GAME -----");
    const startGameTx = await pokerContract.connect(gameCreator).startGame(gameId, veryHighGasTxOptions);
    log("startGame transaction submitted, waiting for confirmation...");
    const startGameReceipt = await startGameTx.wait();
    log("startGame transaction confirmed!");
    
    // Look for the peek phase event
    const peekPhaseEvent = startGameReceipt.events.find(e => e.event === "PeekPhaseStarted");
    if (peekPhaseEvent) {
      log(`Peek phase started for game ${gameId}`);
    }
    
    // Get updated game info
    const updatedGameInfo = await pokerContract.getGameInfo(gameId);
    log(`Game state: ${GameState[updatedGameInfo.state]}`);
    log(`Phase end time: ${new Date(updatedGameInfo.phaseEndTime * 1000).toISOString()}`);
    
    // ===== PEEK PHASE =====
    log("\n----- PLAYERS PEEKING AT CARDS -----");
    
    // Players peek at their cards
    for (let i = 0; i < 5; i++) {
      const player = players[i];
      try {
        // Get initial chip balance
        const playerInfoBefore = await pokerContract.getPlayerInfo(gameId, player.address);
        initialChipBalances[player.address] = playerInfoBefore.chipBalance;
        log(`\nPlayer ${i+1} (${player.address}) attempting to peek:`);
        log(`  Initial chip balance: ${playerInfoBefore.chipBalance}`);
        
        const peekTx = await pokerContract.connect(player).peekAtCard(gameId, highGasTxOptions);
        const peekReceipt = await peekTx.wait();
        log(`  Peek transaction confirmed: ${peekReceipt.transactionHash}`);
        
        // Get chip balance after peeking
        const playerInfoAfter = await pokerContract.getPlayerInfo(gameId, player.address);
        log(`  Chip balance after peeking: ${playerInfoAfter.chipBalance}`);
        log(`  Peek status: ${playerInfoAfter.hasPeeked ? "Has peeked" : "Has not peeked"}`);
      } catch (error) {
        log(`Error when Player ${i+1} tried to peek: ${error.message}`);
      }
    }
    
    // Player 2 will swap their card
    log("\n----- PLAYER SWAPPING CARD -----");
    try {
      const swapPlayer = players[1]; // Player 2
      
      // Get initial balance before swap
      const playerInfoBeforeSwap = await pokerContract.getPlayerInfo(gameId, swapPlayer.address);
      log(`Player 2 (${swapPlayer.address}) attempting to swap:`);
      log(`  Chip balance before swap: ${playerInfoBeforeSwap.chipBalance}`);
      log(`  Peek status: ${playerInfoBeforeSwap.hasPeeked ? "Has peeked" : "Has not peeked"}`);
      log(`  Swap status: ${playerInfoBeforeSwap.hasSwappedCard ? "Has swapped" : "Has not swapped"}`);
      
      const swapTx = await pokerContract.connect(swapPlayer).swapCard(gameId, highGasTxOptions);
      const swapReceipt = await swapTx.wait();
      log(`  Swap transaction confirmed: ${swapReceipt.transactionHash}`);
      
      // Get chip balance after swapping
      const playerInfoAfterSwap = await pokerContract.getPlayerInfo(gameId, swapPlayer.address);
      log(`  Chip balance after swap: ${playerInfoAfterSwap.chipBalance}`);
      log(`  Swap status: ${playerInfoAfterSwap.hasSwappedCard ? "Has swapped" : "Has not swapped"}`);
    } catch (error) {
      log(`Error when Player 2 tried to swap card: ${error.message}`);
    }
    
    // Log all player actions and chip balances after peek phase
    log("\n----- PLAYER STATUS AFTER PEEK PHASE -----");
    for (let i = 0; i < 5; i++) {
      try {
        const playerInfo = await pokerContract.getPlayerInfo(gameId, players[i].address);
        log(`\nPlayer ${i+1} (${players[i].address}):`);
        log(`  Active: ${playerInfo.isActive ? "Yes" : "No"}`);
        log(`  Has peeked: ${playerInfo.hasPeeked ? "Yes" : "No"}`);
        log(`  Has swapped card: ${playerInfo.hasSwappedCard ? "Yes" : "No"}`);
        log(`  Has folded: ${playerInfo.hasFolded ? "Yes" : "No"}`);
        log(`  Chip balance: ${playerInfo.chipBalance}`);
        log(`  Current bet: ${playerInfo.currentBet}`);
      } catch (error) {
        log(`Error getting info for Player ${i+1}: ${error.message}`);
      }
    }
    
    // Wait for keeper to advance the phase
    log("\n----- WAITING FOR KEEPER TO END PEEK PHASE -----");
    
    // Function to poll game state until it changes
    async function waitForGameState(targetState) {
      log(`Waiting for game state to change to ${GameState[targetState]}...`);
      const pollInterval = 5000; // 5 seconds
      const maxPolls = 60; // 5 minutes max
      let polls = 0;
      
      while (polls < maxPolls) {
        polls++;
        const currentGameInfo = await pokerContract.getGameInfo(gameId);
        log(`Current game state: ${GameState[currentGameInfo.state]}, Remaining time: ${currentGameInfo.remainingTime.toString()} seconds`);
        
        if (currentGameInfo.state === targetState) {
          log(`Game state changed to ${GameState[targetState]} after ${polls} polls`);
          return true;
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
      
      log(`Timed out waiting for game state to change to ${GameState[targetState]}`);
      return false;
    }
    
    // Wait for state to change to BETTING (2)
    const bettingPhaseReached = await waitForGameState(2);
    
    if (!bettingPhaseReached) {
      throw new Error("Betting phase not reached - keeper might not be working properly");
    }
    
    // ===== BETTING PHASE =====
    log("\n----- PLAYERS PLACING BETS -----");
    
    // First player places a bet
    const bet1Amount = 5;
    try {
      log(`\nPlayer 1 (${players[0].address}) attempting to bet ${bet1Amount} chips:`);
      const playerInfoBeforeBet = await pokerContract.getPlayerInfo(gameId, players[0].address);
      log(`  Chip balance before betting: ${playerInfoBeforeBet.chipBalance}`);
      
      const bet1Tx = await pokerContract.connect(players[0]).placeBet(gameId, bet1Amount, highGasTxOptions);
      const bet1Receipt = await bet1Tx.wait();
      log(`  Bet transaction confirmed: ${bet1Receipt.transactionHash}`);
      
      // Check pot amount and current bet
      const gameStateAfterBet1 = await pokerContract.getGameInfo(gameId);
      log(`  Pot after bet: ${gameStateAfterBet1.potAmount.toString()}`);
      log(`  Current bet: ${gameStateAfterBet1.currentBet.toString()}`);
      
      const playerInfoAfterBet = await pokerContract.getPlayerInfo(gameId, players[0].address);
      log(`  Chip balance after betting: ${playerInfoAfterBet.chipBalance}`);
      log(`  Current bet: ${playerInfoAfterBet.currentBet}`);
    } catch (error) {
      log(`Error when Player 1 tried to bet: ${error.message}`);
    }
    
    // Second player calls
    const bet2Amount = 5;
    try {
      log(`\nPlayer 2 (${players[1].address}) attempting to bet ${bet2Amount} chips:`);
      const playerInfoBeforeBet = await pokerContract.getPlayerInfo(gameId, players[1].address);
      log(`  Chip balance before betting: ${playerInfoBeforeBet.chipBalance}`);
      
      const bet2Tx = await pokerContract.connect(players[1]).placeBet(gameId, bet2Amount, highGasTxOptions);
      const bet2Receipt = await bet2Tx.wait();
      log(`  Bet transaction confirmed: ${bet2Receipt.transactionHash}`);
      
      // Check pot amount and current bet
      const gameStateAfterBet2 = await pokerContract.getGameInfo(gameId);
      log(`  Pot after bet: ${gameStateAfterBet2.potAmount.toString()}`);
      log(`  Current bet: ${gameStateAfterBet2.currentBet.toString()}`);
      
      const playerInfoAfterBet = await pokerContract.getPlayerInfo(gameId, players[1].address);
      log(`  Chip balance after betting: ${playerInfoAfterBet.chipBalance}`);
      log(`  Current bet: ${playerInfoAfterBet.currentBet}`);
    } catch (error) {
      log(`Error when Player 2 tried to bet: ${error.message}`);
    }
    
    // Third player raises
    const bet3Amount = 10;
    try {
      log(`\nPlayer 3 (${players[2].address}) attempting to bet ${bet3Amount} chips (raising):`);
      const playerInfoBeforeBet = await pokerContract.getPlayerInfo(gameId, players[2].address);
      log(`  Chip balance before betting: ${playerInfoBeforeBet.chipBalance}`);
      
      const bet3Tx = await pokerContract.connect(players[2]).placeBet(gameId, bet3Amount, highGasTxOptions);
      const bet3Receipt = await bet3Tx.wait();
      log(`  Bet transaction confirmed: ${bet3Receipt.transactionHash}`);
      
      // Check pot amount and current bet
      const gameStateAfterBet3 = await pokerContract.getGameInfo(gameId);
      log(`  Pot after bet: ${gameStateAfterBet3.potAmount.toString()}`);
      log(`  Current bet: ${gameStateAfterBet3.currentBet.toString()}`);
      
      const playerInfoAfterBet = await pokerContract.getPlayerInfo(gameId, players[2].address);
      log(`  Chip balance after betting: ${playerInfoAfterBet.chipBalance}`);
      log(`  Current bet: ${playerInfoAfterBet.currentBet}`);
    } catch (error) {
      log(`Error when Player 3 tried to bet: ${error.message}`);
    }
    
    // Fourth player folds
    try {
      log(`\nPlayer 4 (${players[3].address}) attempting to fold:`);
      const playerInfoBeforeFold = await pokerContract.getPlayerInfo(gameId, players[3].address);
      log(`  Fold status before: ${playerInfoBeforeFold.hasFolded ? "Has folded" : "Has not folded"}`);
      
      const foldTx = await pokerContract.connect(players[3]).fold(gameId, highGasTxOptions);
      const foldReceipt = await foldTx.wait();
      log(`  Fold transaction confirmed: ${foldReceipt.transactionHash}`);
      
      // Check active player count
      const gameStateAfterFold = await pokerContract.getGameInfo(gameId);
      log(`  Active players after fold: ${gameStateAfterFold.activeCount.toString()}`);
      
      const playerInfoAfterFold = await pokerContract.getPlayerInfo(gameId, players[3].address);
      log(`  Fold status after: ${playerInfoAfterFold.hasFolded ? "Has folded" : "Has not folded"}`);
    } catch (error) {
      log(`Error when Player 4 tried to fold: ${error.message}`);
    }
    
    // Fifth player places a bet
    const bet4Amount = 10; // Match player 3's bet
    try {
      log(`\nPlayer 5 (${players[4].address}) attempting to bet ${bet4Amount} chips (matching):`);
      const playerInfoBeforeBet = await pokerContract.getPlayerInfo(gameId, players[4].address);
      log(`  Chip balance before betting: ${playerInfoBeforeBet.chipBalance}`);
      
      const bet4Tx = await pokerContract.connect(players[4]).placeBet(gameId, bet4Amount, highGasTxOptions);
      const bet4Receipt = await bet4Tx.wait();
      log(`  Bet transaction confirmed: ${bet4Receipt.transactionHash}`);
      
      // Check pot amount and current bet
      const gameStateAfterBet4 = await pokerContract.getGameInfo(gameId);
      log(`  Pot after bet: ${gameStateAfterBet4.potAmount.toString()}`);
      log(`  Current bet: ${gameStateAfterBet4.currentBet.toString()}`);
      
      const playerInfoAfterBet = await pokerContract.getPlayerInfo(gameId, players[4].address);
      log(`  Chip balance after betting: ${playerInfoAfterBet.chipBalance}`);
      log(`  Current bet: ${playerInfoAfterBet.currentBet}`);
    } catch (error) {
      log(`Error when Player 5 tried to bet: ${error.message}`);
    }
    
    // Log player status after betting
    log("\n----- PLAYER STATUS AFTER BETTING -----");
    for (let i = 0; i < 5; i++) {
      try {
        const playerInfo = await pokerContract.getPlayerInfo(gameId, players[i].address);
        log(`\nPlayer ${i+1} (${players[i].address}):`);
        log(`  Active: ${playerInfo.isActive ? "Yes" : "No"}`);
        log(`  Has peeked: ${playerInfo.hasPeeked ? "Yes" : "No"}`);
        log(`  Has swapped card: ${playerInfo.hasSwappedCard ? "Yes" : "No"}`);
        log(`  Has folded: ${playerInfo.hasFolded ? "Yes" : "No"}`);
        log(`  Chip balance: ${playerInfo.chipBalance}`);
        log(`  Current bet: ${playerInfo.currentBet}`);
      } catch (error) {
        log(`Error getting info for Player ${i+1}: ${error.message}`);
      }
    }
    
    // Set up listener for GameEnded event
    let gameEndedPromise = new Promise((resolve) => {
      const gameEndedListener = pokerContract.once("GameEnded", async (gameIdEvent, winner, potAmount) => {
        if (gameIdEvent.toString() === gameId.toString()) {
          log(`\n===== GAME ENDED EVENT CAPTURED =====`);
          log(`Winner: ${winner}`);
          log(`Pot Amount: ${potAmount.toString()} chips`);
          
          // Find which player number won
          const winnerIndex = players.findIndex(p => p.address.toLowerCase() === winner.toLowerCase());
          if (winnerIndex !== -1) {
            log(`Player ${winnerIndex + 1} (${players[winnerIndex].address}) won the game!`);
          }
          
          resolve({ winner, potAmount });
        }
      });
      
      // Ensure we clean up the listener after a timeout
      setTimeout(() => {
        pokerContract.removeListener("GameEnded", gameEndedListener);
        resolve({ winner: null, potAmount: 0 });
      }, 300000); // 5 minute timeout
    });
    
    // Wait for keeper to end betting phase and showdown
    log("\n----- WAITING FOR KEEPER TO END BETTING PHASE -----");
    
    // Wait for state to change to ENDED (4)
    const gameEndedReached = await waitForGameState(4);
    
    if (!gameEndedReached) {
      throw new Error("Game ended state not reached - keeper might not be working properly");
    }
    
    // Wait for the GameEnded event promise to resolve (if it hasn't already)
    const gameEndResult = await gameEndedPromise;
    if (gameEndResult.winner) {
      log(`Confirmed winner: ${gameEndResult.winner}`);
    } else {
      log("Failed to detect winner asynchronously");
    }
    
    // ===== FINAL GAME STATE =====
    log("\n----- FINAL GAME STATE -----");
    try {
      const finalGameState = await pokerContract.getGameInfo(gameId);
      log(`Game state: ${GameState[finalGameState.state]}`);
      log(`Pot amount: ${finalGameState.potAmount.toString()}`);
      log(`Is cleaned up: ${finalGameState.isCleanedUp ? "Yes" : "No"}`);
      
      // Get final player balances
      log("\n----- FINAL PLAYER BALANCES -----");
      for (let i = 0; i < 5; i++) {
        try {
          const playerInfo = await pokerContract.getPlayerInfo(gameId, players[i].address);
          log(`\nPlayer ${i+1} (${players[i].address}):`);
          log(`  Initial balance: ${initialChipBalances[players[i].address]}`);
          log(`  Final balance: ${playerInfo.chipBalance}`);
          const difference = playerInfo.chipBalance - initialChipBalances[players[i].address];
          log(`  Difference: ${difference}`);
          
          // Check if this player gained chips (potential winner)
          if (difference > 0) {
            log(`*** Player ${i+1} gained ${difference} chips - WINNER! ***`);
          }
        } catch (error) {
          log(`Error getting info for Player ${i+1}: ${error.message}`);
        }
      }
      
      // Wait for keeper to clean up
      log("\n----- WAITING FOR KEEPER TO CLEAN UP THE GAME -----");
      
      // Poll until the game is cleaned up or timeout
      let cleanupPolls = 0;
      const maxCleanupPolls = 20; // About 1.5 minutes max
      let isCleanedUp = false;
      
      while (cleanupPolls < maxCleanupPolls && !isCleanedUp) {
        cleanupPolls++;
        try {
          const finalGameInfo = await pokerContract.getGameInfo(gameId);
          isCleanedUp = finalGameInfo.isCleanedUp;
          log(`Game cleanup status: ${isCleanedUp ? "Cleaned up" : "Not cleaned up"}`);
          
          if (isCleanedUp) {
            log(`Game cleaned up by keeper after ${cleanupPolls} polls`);
            break;
          }
        } catch (error) {
          log(`Error checking cleanup status: ${error.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds between polls
      }
      
      if (!isCleanedUp) {
        log("WARNING: Game not cleaned up after waiting - keeper might not be working properly");
      }
      
    } catch (error) {
      log(`Error getting final game info: ${error.message}`);
    }
    
    log("\n===== ONE CARD POKER KEEPER TEST COMPLETED =====");
  });
});