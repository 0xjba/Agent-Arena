const { ethers, network } = require("hardhat");
const { expect } = require("chai");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Configure logging
const logPath = path.join(__dirname, "security-features-test.txt");
let logStream = fs.createWriteStream(logPath, { flags: "a" });

function log(message) {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] ${message}\n`;
  logStream.write(formattedMessage);
  console.log(message);
}

// GameState enum mapping from PokerGameLibrary
const GameState = {
  0: "REGISTRATION",
  1: "PEEK_PHASE",
  2: "BETTING",
  3: "SHOWDOWN",
  4: "ENDED"
};

// Time advance helper function
async function advanceTime(seconds) {
  if (network.name === "hardhat") {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine");
    log(`Time advanced by ${seconds} seconds`);
  } else {
    log(`Cannot advance time on ${network.name} network, waiting instead...`);
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }
}

// Setup wallets helper function
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
  for (let i = 1; i <= 4; i++) {
    const privateKeyVar = `PLAYER${i}_PRIVATE_KEY`;
    if (!process.env[privateKeyVar]) {
      throw new Error(`${privateKeyVar} is required in .env file`);
    }
    const playerWallet = new ethers.Wallet(process.env[privateKeyVar], provider);
    wallets.push(playerWallet);
  }
  
  // Keeper wallet (if different from owner)
  if (process.env.KEEPER_PRIVATE_KEY && process.env.KEEPER_PRIVATE_KEY !== process.env.OWNER_PRIVATE_KEY) {
    const keeperWallet = new ethers.Wallet(process.env.KEEPER_PRIVATE_KEY, provider);
    wallets.push(keeperWallet);
  }
  
  return wallets;
}

describe("Poker Contract Security Features Tests", function() {
  // Increase timeout for long-running tests
  this.timeout(600000); // 10 minutes

  let cardLibrary;
  let gameLibrary;
  let pokerContract;
  let spectatorContract;
  let owner;
  let keeper;
  let players = [];
  let gameId;
  
  // Transaction options
  const txOptions = { gasLimit: 500000 };
  const highGasTxOptions = { gasLimit: 2000000 };
  const veryHighGasTxOptions = { gasLimit: 8000000 };

  // Deploy contracts
  before(async function() {
    log("\n===== SETTING UP TEST ENVIRONMENT =====");
    
    // Set up wallets from .env
    const provider = ethers.provider;
    const wallets = await setupWallets(provider);
    
    // Wallet assignments
    owner = wallets[0];
    players = wallets.slice(1, 5);
    keeper = wallets.length > 5 ? wallets[5] : owner;
    
    // Log wallet addresses
    log(`Owner address: ${owner.address}`);
    players.forEach((player, index) => {
      log(`Player ${index + 1} address: ${player.address}`);
    });
    log(`Keeper address: ${keeper.address}`);
    
    // Check if contracts are already deployed
    if (process.env.POKER_CONTRACT_ADDRESS && 
        process.env.SPECTATOR_CONTRACT_ADDRESS && 
        process.env.CARD_LIBRARY_ADDRESS && 
        process.env.GAME_LIBRARY_ADDRESS) {
      
      log(`\nUsing existing contracts:`);
      log(`CardLibrary: ${process.env.CARD_LIBRARY_ADDRESS}`);
      log(`GameLibrary: ${process.env.GAME_LIBRARY_ADDRESS}`);
      log(`OneCard: ${process.env.POKER_CONTRACT_ADDRESS}`);
      log(`PokerSpectatorView: ${process.env.SPECTATOR_CONTRACT_ADDRESS}`);

      // Get factories for all contracts
      const CardLibraryFactory = await ethers.getContractFactory("CardLibrary");
      const GameLibraryFactory = await ethers.getContractFactory("GameLibrary");
      const PokerFactory = await ethers.getContractFactory("OneCard");
      const SpectatorFactory = await ethers.getContractFactory("PokerSpectatorView");

      // Attach to existing contracts
      cardLibrary = CardLibraryFactory.attach(process.env.CARD_LIBRARY_ADDRESS);
      gameLibrary = GameLibraryFactory.attach(process.env.GAME_LIBRARY_ADDRESS);
      pokerContract = PokerFactory.attach(process.env.POKER_CONTRACT_ADDRESS);
      spectatorContract = SpectatorFactory.attach(process.env.SPECTATOR_CONTRACT_ADDRESS);
    } else {
      // Deploy contracts from scratch
      log("\n----- DEPLOYING CONTRACTS -----");
      
      // Deploy libraries first
      log("Deploying CardLibrary...");
      const CardLibraryFactory = await ethers.getContractFactory("CardLibrary");
      cardLibrary = await CardLibraryFactory.connect(owner).deploy();
      await cardLibrary.deployed();
      log(`CardLibrary deployed at: ${cardLibrary.address}`);

      log("Deploying GameLibrary...");
      const GameLibraryFactory = await ethers.getContractFactory("GameLibrary");
      gameLibrary = await GameLibraryFactory.connect(owner).deploy();
      await gameLibrary.deployed();
      log(`GameLibrary deployed at: ${gameLibrary.address}`);

      // Link libraries to main contract
      const PokerFactory = await ethers.getContractFactory("OneCard", {
        libraries: {
          CardLibrary: cardLibrary.address,
          GameLibrary: gameLibrary.address
        }
      });
      
      log("Deploying OneCard main contract...");
      pokerContract = await PokerFactory.connect(owner).deploy();
      await pokerContract.deployed();
      log(`OneCard contract deployed at: ${pokerContract.address}`);

      // Deploy spectator contract
      log("Deploying PokerSpectatorView contract...");
      const SpectatorFactory = await ethers.getContractFactory("PokerSpectatorView");
      spectatorContract = await SpectatorFactory.connect(owner).deploy(pokerContract.address);
      await spectatorContract.deployed();
      log(`PokerSpectatorView contract deployed at: ${spectatorContract.address}`);
    }

    // Add keeper if different from owner
    if (keeper.address !== owner.address) {
      log("\n----- ADDING KEEPER -----");
      const addKeeperTx = await pokerContract.connect(owner).addKeeper(keeper.address, txOptions);
      await addKeeperTx.wait();
      log(`Added ${keeper.address} as a keeper`);
    }
    
    // Add players to whitelist
    log("\n----- ADDING PLAYERS TO WHITELIST -----");
    const playerAddresses = players.map(player => player.address);
    const tx = await pokerContract.connect(owner).addMultipleToWhitelist(playerAddresses, highGasTxOptions);
    await tx.wait();
    log(`Added ${players.length} players to whitelist`);
  });

  // Tests for Buffer Period functionality
  describe("Buffer Period Tests", function() {
    let testGameId;

    // Create a new game for buffer period tests
    beforeEach(async function() {
      log("\n----- CREATING A NEW GAME FOR BUFFER PERIOD TESTS -----");
      const createTx = await pokerContract.connect(keeper).createGame(txOptions);
      const createReceipt = await createTx.wait();
      
      // Extract gameId from the event logs
      const gameCreatedEvent = createReceipt.events.find(e => e.event === "GameCreated");
      testGameId = gameCreatedEvent.args.gameId.toNumber();
      log(`Created Game with ID: ${testGameId}`);
    });

    it("Should enforce buffer period when transitioning from registration to peek phase", async function() {
      log("\n----- TESTING BUFFER PERIOD FOR PEEK PHASE -----");
      
      // Start peek phase
      const startPeekTx = await pokerContract.connect(keeper).startPeekPhase(testGameId, veryHighGasTxOptions);
      const startPeekReceipt = await startPeekTx.wait();
      
      // Verify BufferPeriodStarted event was emitted
      const bufferEvent = startPeekReceipt.events.find(e => e.event === "BufferPeriodStarted");
      expect(bufferEvent).to.not.be.undefined;
      expect(bufferEvent.args.currentState).to.equal(0); // REGISTRATION
      expect(bufferEvent.args.nextState).to.equal(1); // PEEK_PHASE
      
      // Get game info with buffer end time
      const gameInfo = await pokerContract.getGameInfo(testGameId);
      const bufferEndTime = gameInfo.bufferEndTime;
      
      log(`Buffer period ends at: ${new Date(bufferEndTime * 1000).toISOString()}`);
      
      // Attempt to peek at card during buffer period (should fail)
      try {
        await pokerContract.connect(players[0]).peekAtCard(testGameId, txOptions);
        // If we get here, the test failed
        expect.fail("Peek during buffer period should have failed");
      } catch (error) {
        // Verify error contains expected message
        expect(error.message).to.include("In buffer period");
        log("✅ Successfully prevented peek action during buffer period");
      }
      
      // Advance time past buffer period
      const currentTime = Math.floor(Date.now() / 1000);
      const waitTime = Number(bufferEndTime) - currentTime + 5; // Add 5 seconds for safety
      await advanceTime(waitTime > 0 ? waitTime : 5);
      
      // Now peek should succeed
      try {
        const peekTx = await pokerContract.connect(players[0]).peekAtCard(testGameId, txOptions);
        await peekTx.wait();
        log("✅ Successfully peeked at card after buffer period ended");
      } catch (error) {
        log(`ERROR: ${error.message}`);
        expect.fail("Peek after buffer period should succeed");
      }
    });
    
    it("Should enforce buffer period when transitioning from peek to betting phase", async function() {
      log("\n----- TESTING BUFFER PERIOD FOR BETTING PHASE -----");
      
      // Start peek phase
      const startPeekTx = await pokerContract.connect(keeper).startPeekPhase(testGameId, veryHighGasTxOptions);
      await startPeekTx.wait();
      
      // Get buffer end time
      let gameInfo = await pokerContract.getGameInfo(testGameId);
      let bufferEndTime = gameInfo.bufferEndTime;
      
      // Advance time past peek phase buffer
      const currentTime1 = Math.floor(Date.now() / 1000);
      const waitTime1 = Number(bufferEndTime) - currentTime1 + 5;
      await advanceTime(waitTime1 > 0 ? waitTime1 : 5);
      
      // Advance time past peek phase end time
      const advanceToEnd = Number(gameInfo.phaseEndTime) - Math.floor(Date.now() / 1000) + 5;
      await advanceTime(advanceToEnd > 0 ? advanceToEnd : 5);
      
      // End peek phase
      const endPeekTx = await pokerContract.connect(keeper).endPeekPhase(testGameId, veryHighGasTxOptions);
      const endPeekReceipt = await endPeekTx.wait();
      
      // Verify BufferPeriodStarted event was emitted
      const bufferEvent = endPeekReceipt.events.find(e => e.event === "BufferPeriodStarted");
      expect(bufferEvent).to.not.be.undefined;
      expect(bufferEvent.args.currentState).to.equal(1); // PEEK_PHASE
      expect(bufferEvent.args.nextState).to.equal(2); // BETTING
      
      // Get updated game info with new buffer end time
      gameInfo = await pokerContract.getGameInfo(testGameId);
      bufferEndTime = gameInfo.bufferEndTime;
      
      log(`Betting buffer period ends at: ${new Date(bufferEndTime * 1000).toISOString()}`);
      
      // Attempt to place bet during buffer period (should fail)
      try {
        await pokerContract.connect(players[0]).placeBet(testGameId, 1, txOptions);
        expect.fail("Bet during buffer period should have failed");
      } catch (error) {
        expect(error.message).to.include("In buffer period");
        log("✅ Successfully prevented bet action during buffer period");
      }
      
      // Advance time past buffer period
      const currentTime2 = Math.floor(Date.now() / 1000);
      const waitTime2 = Number(bufferEndTime) - currentTime2 + 5;
      await advanceTime(waitTime2 > 0 ? waitTime2 : 5);
      
      // Now bet should succeed
      try {
        const betTx = await pokerContract.connect(players[0]).placeBet(testGameId, 1, txOptions);
        await betTx.wait();
        log("✅ Successfully placed bet after buffer period ended");
      } catch (error) {
        log(`ERROR: ${error.message}`);
        expect.fail("Bet after buffer period should succeed");
      }
    });
  });

  // Tests for State Version system
  describe("State Version Tests", function() {
    let testGameId;
    
    // Create a new game for version tests
    beforeEach(async function() {
      log("\n----- CREATING A NEW GAME FOR VERSION TESTS -----");
      const createTx = await pokerContract.connect(keeper).createGame(txOptions);
      const createReceipt = await createTx.wait();
      
      // Extract gameId from the event logs
      const gameCreatedEvent = createReceipt.events.find(e => e.event === "GameCreated");
      testGameId = gameCreatedEvent.args.gameId.toNumber();
      log(`Created Game with ID: ${testGameId}`);
    });

    it("Should increment state version on phase transitions", async function() {
      log("\n----- TESTING STATE VERSION INCREMENTS -----");
      
      // Check initial state version
      let gameInfo = await pokerContract.getGameInfo(testGameId);
      const initialVersion = gameInfo.stateVersion;
      log(`Initial state version: ${initialVersion}`);
      
      // Start peek phase
      const startPeekTx = await pokerContract.connect(keeper).startPeekPhase(testGameId, veryHighGasTxOptions);
      await startPeekTx.wait();
      
      // Check that version was incremented
      gameInfo = await pokerContract.getGameInfo(testGameId);
      const peekPhaseVersion = gameInfo.stateVersion;
      log(`Peek phase state version: ${peekPhaseVersion}`);
      expect(peekPhaseVersion).to.be.gt(initialVersion);
      
      // Wait for buffer to end
      await advanceTime(35); // Buffer is 30 seconds
      
      // Skip to end of peek phase
      const skipTime = Number(gameInfo.phaseEndTime) - Math.floor(Date.now() / 1000) + 5;
      await advanceTime(skipTime > 0 ? skipTime : 5);
      
      // End peek phase
      const endPeekTx = await pokerContract.connect(keeper).endPeekPhase(testGameId, veryHighGasTxOptions);
      await endPeekTx.wait();
      
      // Check version incremented again
      gameInfo = await pokerContract.getGameInfo(testGameId);
      const bettingPhaseVersion = gameInfo.stateVersion;
      log(`Betting phase state version: ${bettingPhaseVersion}`);
      expect(bettingPhaseVersion).to.be.gt(peekPhaseVersion);
      
      // Wait for buffer to end
      await advanceTime(35); // Buffer is 30 seconds
      
      // Check version through spectator contract
      const spectatorVersion = await spectatorContract.getStateVersionQuick(testGameId);
      log(`Spectator view state version: ${spectatorVersion}`);
      expect(spectatorVersion).to.equal(bettingPhaseVersion);
      
      // Listen for GameStateUpdated events
      const filter = pokerContract.filters.GameStateUpdated(testGameId);
      const events = await pokerContract.queryFilter(filter);
      
      // Verify events include version
      for (const event of events) {
        expect(event.args.stateVersion).to.not.be.undefined;
        log(`Found GameStateUpdated event with version: ${event.args.stateVersion}`);
      }
    });
  });

  // Tests for Action Nonce system
  describe("Action Nonce Tests", function() {
    let testGameId;
    
    // Create a new game for nonce tests
    beforeEach(async function() {
      log("\n----- CREATING A NEW GAME FOR ACTION NONCE TESTS -----");
      const createTx = await pokerContract.connect(keeper).createGame(txOptions);
      const createReceipt = await createTx.wait();
      
      // Extract gameId from the event logs
      const gameCreatedEvent = createReceipt.events.find(e => e.event === "GameCreated");
      testGameId = gameCreatedEvent.args.gameId.toNumber();
      log(`Created Game with ID: ${testGameId}`);
      
      // Start peek phase
      const startPeekTx = await pokerContract.connect(keeper).startPeekPhase(testGameId, veryHighGasTxOptions);
      await startPeekTx.wait();
      
      // Wait for buffer to end
      await advanceTime(35); // Buffer is 30 seconds
    });

    it("Should increment action nonce on player actions", async function() {
      log("\n----- TESTING ACTION NONCE INCREMENTS -----");
      
      // Check initial nonce
      let playerInfo = await pokerContract.getPlayerInfo(testGameId, players[0].address);
      const initialNonce = playerInfo.actionNonce;
      log(`Initial action nonce: ${initialNonce}`);
      
      // Peek at card
      const peekTx = await pokerContract.connect(players[0]).peekAtCard(testGameId, txOptions);
      const peekReceipt = await peekTx.wait();
      
      // Verify PlayerAction event includes nonce
      const actionEvent = peekReceipt.events.find(e => e.event === "PlayerAction");
      expect(actionEvent).to.not.be.undefined;
      expect(actionEvent.args.nonce).to.be.gt(initialNonce);
      log(`Action event nonce: ${actionEvent.args.nonce}`);
      
      // Check player info after action
      playerInfo = await pokerContract.getPlayerInfo(testGameId, players[0].address);
      const afterPeekNonce = playerInfo.actionNonce;
      log(`After peek action nonce: ${afterPeekNonce}`);
      expect(afterPeekNonce).to.be.gt(initialNonce);
    });
    
    it("Should increment nonce for different player actions", async function() {
      log("\n----- TESTING DIFFERENT ACTION NONCE INCREMENTS -----");
      
      // Use Monty Hall option
      const montyHallTx = await pokerContract.connect(players[1]).useMontyHallOption(testGameId, txOptions);
      const montyHallReceipt = await montyHallTx.wait();
      
      // Check nonce in event
      const montyEvent = montyHallReceipt.events.find(e => e.event === "PlayerAction");
      expect(montyEvent).to.not.be.undefined;
      const montyNonce = montyEvent.args.nonce;
      log(`Monty Hall action nonce: ${montyNonce}`);
      
      // Make Monty Hall decision and check nonce increment
      const decisionTx = await pokerContract.connect(players[1]).montyHallDecision(testGameId, true, txOptions);
      const decisionReceipt = await decisionTx.wait();
      
      // Check nonce in event
      const decisionEvent = decisionReceipt.events.find(e => e.event === "PlayerAction");
      expect(decisionEvent).to.not.be.undefined;
      const decisionNonce = decisionEvent.args.nonce;
      log(`Monty Hall decision nonce: ${decisionNonce}`);
      
      // Verify nonce was incremented
      expect(decisionNonce).to.be.gt(montyNonce);
    });
  });

  // Tests for Cleanup Safeguards
  describe("Cleanup Safeguard Tests", function() {
    let testGameId;
    
    // Create and play a complete game to test cleanup
    before(async function() {
      log("\n----- CREATING AND COMPLETING A GAME FOR CLEANUP TESTS -----");
      
      // Create game
      const createTx = await pokerContract.connect(keeper).createGame(txOptions);
      const createReceipt = await createTx.wait();
      const gameCreatedEvent = createReceipt.events.find(e => e.event === "GameCreated");
      testGameId = gameCreatedEvent.args.gameId.toNumber();
      log(`Created Game with ID: ${testGameId}`);
      
      // Start peek phase
      const startPeekTx = await pokerContract.connect(keeper).startPeekPhase(testGameId, veryHighGasTxOptions);
      await startPeekTx.wait();
      
      // Wait for buffer and peek phase to end
      let gameInfo = await pokerContract.getGameInfo(testGameId);
      const skipToEndOfPeek = Number(gameInfo.phaseEndTime) - Math.floor(Date.now() / 1000) + 10;
      await advanceTime(skipToEndOfPeek > 0 ? skipToEndOfPeek : 10);
      
      // End peek phase and start betting
      const endPeekTx = await pokerContract.connect(keeper).endPeekPhase(testGameId, veryHighGasTxOptions);
      await endPeekTx.wait();
      
      // Wait for buffer to end
      await advanceTime(35); // Buffer is 30 seconds
      
      // Let player 0 place a bet
      const betTx = await pokerContract.connect(players[0]).placeBet(testGameId, 5, txOptions);
      await betTx.wait();
      
      // Let other players fold
      for (let i = 1; i < 3; i++) {
        const foldTx = await pokerContract.connect(players[i]).fold(testGameId, txOptions);
        await foldTx.wait();
      }
      
      // Get updated game state
      gameInfo = await pokerContract.getGameInfo(testGameId);
      
      // Skip to end of betting phase if not already ended
      if (gameInfo.state === 2) { // BETTING
        // End betting phase
        const endBettingTx = await pokerContract.connect(keeper).endBettingPhase(testGameId, veryHighGasTxOptions);
        await endBettingTx.wait();
      }
      
      // Game should now be in ENDED state
      gameInfo = await pokerContract.getGameInfo(testGameId);
      expect(gameInfo.state).to.equal(4); // ENDED
      log(`Game is now in ${GameState[gameInfo.state]} state`);
    });
    
    it("Should mark game as cleaned up after cleanup", async function() {
      log("\n----- TESTING CLEANUP FLAG -----");
      
      // Verify game is not cleaned up initially
      let gameInfo = await pokerContract.getGameInfo(testGameId);
      expect(gameInfo.isCleanedUp).to.be.false;
      
      // Clean up the game
      const cleanupTx = await pokerContract.connect(keeper).cleanup(testGameId, txOptions);
      await cleanupTx.wait();
      
      // Verify game is now marked as cleaned up
      gameInfo = await pokerContract.getGameInfo(testGameId);
      expect(gameInfo.isCleanedUp).to.be.true;
      log("✅ Game correctly marked as cleaned up");
      
      // Verify event was emitted
      const filter = pokerContract.filters.GameNoLongerSpectatable(testGameId);
      const events = await pokerContract.queryFilter(filter);
      expect(events.length).to.be.gt(0);
      log("✅ GameNoLongerSpectatable event was emitted");
    });
    
    it("Should prevent actions on cleaned up games", async function() {
      log("\n----- TESTING PREVENTION OF ACTIONS ON CLEANED UP GAMES -----");
      
      // Attempt to perform actions on cleaned up game
      try {
        await pokerContract.connect(keeper).startPeekPhase(testGameId, txOptions);
        expect.fail("Action on cleaned up game should have failed");
      } catch (error) {
        expect(error.message).to.include("Game already cleaned up");
        log("✅ Successfully prevented startPeekPhase on cleaned up game");
      }
      
      try {
        await pokerContract.connect(players[0]).joinGame(testGameId, txOptions);
        expect.fail("Join on cleaned up game should have failed");
      } catch (error) {
        expect(error.message).to.include("Game already cleaned up");
        log("✅ Successfully prevented joinGame on cleaned up game");
      }
      
      try {
        await pokerContract.connect(keeper).cleanup(testGameId, txOptions);
        expect.fail("Cleanup on already cleaned up game should have failed");
      } catch (error) {
        expect(error.message).to.include("Game already cleaned up");
        log("✅ Successfully prevented duplicate cleanup");
      }
    });
  });

  // Tests for Spectator View Contract
  describe("Spectator View Tests", function() {
    let testGameId;
    
    // Create a new game for spectator view tests
    before(async function() {
      log("\n----- CREATING A NEW GAME FOR SPECTATOR VIEW TESTS -----");
      const createTx = await pokerContract.connect(keeper).createGame(txOptions);
      const createReceipt = await createTx.wait();
      
      // Extract gameId from the event logs
      const gameCreatedEvent = createReceipt.events.find(e => e.event === "GameCreated");
      testGameId = gameCreatedEvent.args.gameId.toNumber();
      log(`Created Game with ID: ${testGameId}`);
    });
    
    it("Should have efficient state polling through version checks", async function() {
      log("\n----- TESTING SPECTATOR VIEW POLLING EFFICIENCY -----");
      
      // Get initial state version
      const initialVersion = await spectatorContract.getStateVersionQuick(testGameId);
      log(`Initial state version from quick check: ${initialVersion}`);
      
      // Start peek phase to change state
      const startPeekTx = await pokerContract.connect(keeper).startPeekPhase(testGameId, veryHighGasTxOptions);
      await startPeekTx.wait();
      
      // Check version again - should be incremented
      const updatedVersion = await spectatorContract.getStateVersionQuick(testGameId);
      log(`Updated state version from quick check: ${updatedVersion}`);
      expect(updatedVersion).to.be.gt(initialVersion);
      
      // Get more detailed game info
      const phaseInfo = await spectatorContract.getGamePhase(testGameId);
      log(`Game phase from spectator view: ${GameState[phaseInfo]}`);
      
      const potInfo = await spectatorContract.getPotInfo(testGameId);
      log(`Pot amount: ${potInfo.potAmount}, Current bet: ${potInfo.currentBet}`);
      
      const versionInfo = await spectatorContract.getGameVersion(testGameId);
      log(`State version: ${versionInfo.stateVersion}, Is cleaned up: ${versionInfo.isCleanedUp}`);
      
      // Verify all these specialized functions work correctly
      expect(versionInfo.stateVersion).to.equal(updatedVersion);
    });
    
    it("Should get player data for spectating", async function() {
      log("\n----- TESTING SPECTATOR PLAYER DATA -----");
      
      // Get player data through spectator view
      const playerData = await spectatorContract.getSpectatorPlayerData(testGameId);
      
      // Verify data structure
      expect(playerData.playerAddresses).to.not.be.undefined;
      expect(playerData.playerActiveBits).to.not.be.undefined;
      expect(playerData.playerFoldedBits).to.not.be.undefined;
      expect(playerData.playerChipBalances).to.not.be.undefined;
      expect(playerData.playerCurrentBets).to.not.be.undefined;
      expect(playerData.playerActionNonces).to.not.be.undefined;
      
      log(`Spectator view shows ${playerData.playerAddresses.length} players`);
      
      // Check if first player's data matches direct query
      const directPlayerInfo = await pokerContract.getPlayerInfo(testGameId, playerData.playerAddresses[0]);
      
      expect(playerData.playerActiveBits[0]).to.equal(directPlayerInfo.isActive);
      expect(playerData.playerFoldedBits[0]).to.equal(directPlayerInfo.hasFolded);
      log("✅ Spectator player data matches direct query data");
    });
  });

  // Explicit State Checks Tests
  describe("Explicit State Checks Tests", function() {
    let testGameId;
    
    // Create a new game for explicit state check tests
    beforeEach(async function() {
      log("\n----- CREATING A NEW GAME FOR EXPLICIT STATE CHECK TESTS -----");
      const createTx = await pokerContract.connect(keeper).createGame(txOptions);
      const createReceipt = await createTx.wait();
      
      // Extract gameId from the event logs
      const gameCreatedEvent = createReceipt.events.find(e => e.event === "GameCreated");
      testGameId = gameCreatedEvent.args.gameId.toNumber();
      log(`Created Game with ID: ${testGameId}`);
      
      // Start peek phase
      const startPeekTx = await pokerContract.connect(keeper).startPeekPhase(testGameId, veryHighGasTxOptions);
      await startPeekTx.wait();
      
      // Wait for buffer to end
      await advanceTime(35); // Buffer is 30 seconds
    });

    it("Should enforce explicit state checks for Monty Hall operations", async function() {
      log("\n----- TESTING MONTY HALL EXPLICIT STATE CHECKS -----");
      
      // Use Monty Hall option
      const montyHallTx = await pokerContract.connect(players[0]).useMontyHallOption(testGameId, txOptions);
      await montyHallTx.wait();
      log("Player used Monty Hall option");
      
      // Try to use Monty Hall again (should fail due to explicit state check)
      try {
        await pokerContract.connect(players[0]).useMontyHallOption(testGameId, txOptions);
        expect.fail("Second Monty Hall usage should have failed");
      } catch (error) {
        expect(error.message).to.include("Already used Monty Hall option");
        log("✅ Successfully prevented duplicate Monty Hall usage");
      }
      
      // Try Monty Hall decision without having used Monty Hall (should fail)
      try {
        await pokerContract.connect(players[1]).montyHallDecision(testGameId, true, txOptions);
        expect.fail("Monty Hall decision without using option should have failed");
      } catch (error) {
        expect(error.message).to.include("Monty Hall option not used");
        log("✅ Successfully prevented Monty Hall decision without using option");
      }
      
      // Normal flow should work
      const decisionTx = await pokerContract.connect(players[0]).montyHallDecision(testGameId, true, txOptions);
      await decisionTx.wait();
      log("✅ Successfully made Monty Hall decision after using option");
    });
    
    it("Should enforce game state checks for operations", async function() {
      log("\n----- TESTING GAME STATE CHECKS -----");
      
      // Skip to end of peek phase
      const gameInfo = await pokerContract.getGameInfo(testGameId);
      const skipTime = Number(gameInfo.phaseEndTime) - Math.floor(Date.now() / 1000) + 5;
      await advanceTime(skipTime > 0 ? skipTime : 5);
      
      // End peek phase and start betting
      const endPeekTx = await pokerContract.connect(keeper).endPeekPhase(testGameId, veryHighGasTxOptions);
      await endPeekTx.wait();
      
      // Wait for buffer to end
      await advanceTime(35); // Buffer is 30 seconds
      
      // Try to peek at card during betting phase (should fail)
      try {
        await pokerContract.connect(players[0]).peekAtCard(testGameId, txOptions);
        expect.fail("Peek during betting phase should have failed");
      } catch (error) {
        expect(error.message).to.include("Not peek phase");
        log("✅ Successfully prevented peek action during betting phase");
      }
      
      // Try to use Monty Hall option during betting phase (should fail)
      try {
        await pokerContract.connect(players[0]).useMontyHallOption(testGameId, txOptions);
        expect.fail("Monty Hall during betting phase should have failed");
      } catch (error) {
        expect(error.message).to.include("Not peek phase");
        log("✅ Successfully prevented Monty Hall action during betting phase");
      }
      
      // Placing bet should work in betting phase
      const betTx = await pokerContract.connect(players[0]).placeBet(testGameId, 5, txOptions);
      await betTx.wait();
      log("✅ Successfully placed bet during betting phase");
    });
  });

  // Close log file after all tests
  after(async function() {
    logStream.end();
    log("\n===== ALL SECURITY FEATURE TESTS COMPLETED =====");
  });
});