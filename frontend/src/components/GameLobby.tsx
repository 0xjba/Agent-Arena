import React, { useEffect, useState } from 'react';
import { Plus, Users, Clock, ArrowRight, Award, Eye } from 'lucide-react';
import { createGame, joinGame, getGameInfo, GameInfo, GameState, getCurrentGameId, getPlayers, getRevealedCards, RevealedCards } from '../lib/contract';
import toast from 'react-hot-toast';

interface GameLobbyProps {
  onGameJoin: (gameId: number) => void;
  playerAddress: string;
  isContractInitialized: boolean;
}

export function GameLobby({ onGameJoin, playerAddress, isContractInitialized }: GameLobbyProps) {
  const [availableGames, setAvailableGames] = useState<{ id: number; info: GameInfo }[]>([]);
  const [currentGame, setCurrentGame] = useState<{ id: number; info: GameInfo } | null>(null);
  const [pastGames, setPastGames] = useState<{ id: number; info: GameInfo; isWinner?: boolean; revealedCards?: RevealedCards }[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState<number | null>(null);
  const [isViewingPast, setIsViewingPast] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showPastGames, setShowPastGames] = useState(false);

  useEffect(() => {
    if (isContractInitialized) {
      pollGames();
      fetchPastGames();
      const interval = setInterval(pollGames, 5000);
      return () => clearInterval(interval);
    }
  }, [isContractInitialized, playerAddress]);
  
  const fetchPastGames = async () => {
    if (!isContractInitialized || !playerAddress) return;
    
    try {
      setIsLoading(true);
      const currentGameId = await getCurrentGameId();
      const pastGamesList = [];
      
      for (let i = 1; i <= currentGameId; i++) {
        try {
          const gameInfo = await getGameInfo(i);
          
          // Check if the game is ended
          if (gameInfo.state === GameState.ENDED && !gameInfo.isCleanedUp) {
            const players = await getPlayers(i);
            
            // Check if player participated in this game
            if (players.some(p => p.toLowerCase() === playerAddress.toLowerCase())) {
              // Get revealed cards
              let revealedCards;
              try {
                revealedCards = await getRevealedCards(i);
              } catch (error) {
                console.error(`Error getting revealed cards for game ${i}:`, error);
                revealedCards = { players: [], values: [], suits: [] };
              }
              
              // Check if this player won (if they match the creator as a simple way to check)
              // In a real implementation, you would compare this with the GameEnded event winner
              const isWinner = gameInfo.creator.toLowerCase() === playerAddress.toLowerCase();
              
              pastGamesList.push({ 
                id: i, 
                info: gameInfo,
                isWinner,
                revealedCards
              });
            }
          }
        } catch (error) {
          console.error(`Error fetching past game ${i}:`, error);
        }
      }
      
      setPastGames(pastGamesList);
    } catch (error) {
      console.error('Error fetching past games:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const findCurrentGame = async () => {
    try {
      const currentGameId = await getCurrentGameId();
      for (let i = 1; i <= currentGameId; i++) {
        const gameInfo = await getGameInfo(i);
        const players = await getPlayers(i);
        if (
          players.some(p => p.toLowerCase() === playerAddress.toLowerCase()) && 
          gameInfo.state !== GameState.ENDED && 
          !gameInfo.isCleanedUp
        ) {
          return { id: i, info: gameInfo };
        }
      }
    } catch (error) {
      console.error('Error finding current game:', error);
    }
    return null;
  };

  const pollGames = async () => {
    if (!isContractInitialized) return;

    try {
      setIsLoading(true);
      // First find the current game the player is in
      const current = await findCurrentGame();
      setCurrentGame(current);

      // Then get available games
      const currentGameId = await getCurrentGameId();
      const games = [];

      for (let i = 1; i <= currentGameId; i++) {
        try {
          const gameInfo = await getGameInfo(i);
          if (gameInfo.state === GameState.PRE_GAME && !gameInfo.isCleanedUp && (!current || i !== current.id)) {
            games.push({ id: i, info: gameInfo });
          }
        } catch (error) {
          console.error(`Error fetching game ${i}:`, error);
        }
      }

      setAvailableGames(games);
    } catch (error) {
      console.error('Error polling games:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateGame = async () => {
    if (currentGame) {
      toast.error('You are already in a game. Please finish or leave your current game first.');
      return;
    }

    try {
      setIsCreating(true);
      const gameId = await createGame();
      toast.success('Game created successfully!');
      onGameJoin(gameId);
    } catch (error: any) {
      console.error('Error creating game:', error);
      const errorMessage = error?.data?.message || error?.message || 'Failed to create game';
      toast.error(errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinGame = async (gameId: number) => {
    if (currentGame) {
      toast.error('You are already in a game. Please finish or leave your current game first.');
      return;
    }

    try {
      setIsJoining(gameId);
      await joinGame(gameId);
      toast.success('Joined game successfully!');
      onGameJoin(gameId);
    } catch (error: any) {
      console.error('Error joining game:', error);
      const errorMessage = error?.data?.message || error?.message || 'Failed to join game';
      toast.error(errorMessage);
    } finally {
      setIsJoining(null);
    }
  };

  // Helper function to convert card values to readable format
  const getCardDisplay = (value: number, suit: number) => {
    const cardValues = {
      2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
      11: 'J', 12: 'Q', 13: 'K', 14: 'A'
    };
    const suits = ['♥', '♦', '♣', '♠'];
    const suitColor = suit < 2 ? 'text-red-500' : 'text-white';
    
    return (
      <span className={suitColor}>
        {cardValues[value as keyof typeof cardValues] || value}{suits[suit] || ''}
      </span>
    );
  };

  const renderPastGameCard = (id: number, info: GameInfo, isWinner: boolean = false, revealedCards?: RevealedCards) => (
    <div
      key={id}
      className={`bg-gray-800 rounded-lg p-6 ${
        isWinner ? 'ring-2 ring-yellow-500' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-xl font-semibold">Game #{id}</h3>
            {isWinner && (
              <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-sm rounded-full">
                Winner
              </span>
            )}
          </div>
          <div className="flex gap-4 text-gray-400">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span>{info.playerCount} players</span>
            </div>
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4" />
              <span>Pot: {info.potAmount}</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setIsViewingPast(id === isViewingPast ? null : id)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
        >
          <Eye className="w-4 h-4" />
          {isViewingPast === id ? 'Hide Details' : 'View Cards'}
        </button>
      </div>
      
      {isViewingPast === id && revealedCards && (
        <div className="mt-4 p-4 bg-gray-900 rounded-lg">
          <h4 className="text-sm font-medium text-gray-400 mb-3">Revealed Cards</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {revealedCards.players.map((player, index) => (
              <div 
                key={index} 
                className={`p-3 rounded-md ${player.toLowerCase() === playerAddress.toLowerCase() ? 'bg-indigo-900/30' : 'bg-gray-800'}`}
              >
                <div className="text-xs text-gray-400 mb-1">
                  {player === playerAddress ? 'You' : player.slice(0, 6) + '...' + player.slice(-4)}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-medium">
                    {getCardDisplay(revealedCards.values[index], revealedCards.suits[index])}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderGameCard = (id: number, info: GameInfo, isCurrent: boolean = false) => (
    <div
      key={id}
      className={`bg-gray-800 rounded-lg p-6 flex items-center justify-between ${
        isCurrent ? 'ring-2 ring-emerald-500' : ''
      }`}
    >
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-xl font-semibold">Game #{id}</h3>
          {isCurrent && (
            <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-sm rounded-full">
              Your Current Game
            </span>
          )}
        </div>
        <div className="flex gap-4 text-gray-400">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            <span>{info.playerCount} / 5 players</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <span>{isCurrent ? GameState[info.state] : 'Waiting for players'}</span>
          </div>
        </div>
      </div>
      {isCurrent ? (
        <button
          onClick={() => onGameJoin(id)}
          className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
          Return to Game
        </button>
      ) : (
        <button
          onClick={() => handleJoinGame(id)}
          disabled={isJoining === id || !!currentGame}
          className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isJoining === id ? 'Joining...' : 'Join Game'}
        </button>
      )}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold">Game Lobby</h2>
        <button
          onClick={handleCreateGame}
          disabled={isCreating || !isContractInitialized || !!currentGame}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-5 h-5" />
          {isCreating ? 'Creating...' : 'Create Game'}
        </button>
      </div>

      <div className="grid gap-4">
        {!isContractInitialized || isLoading ? (
          <div className="text-center py-8 bg-gray-800 rounded-lg">
            <p className="text-gray-400">
              {!isContractInitialized ? 'Connecting to game contract...' : 'Loading games...'}
            </p>
          </div>
        ) : (
          <>
            {currentGame && (
              <div className="mb-8">
                <h3 className="text-lg font-semibold mb-4 text-gray-300">Your Current Game</h3>
                {renderGameCard(currentGame.id, currentGame.info, true)}
              </div>
            )}

            {/* Game tabs */}
            <div className="flex border-b border-gray-700 mb-6">
              <button
                onClick={() => setShowPastGames(false)}
                className={`py-2 px-4 font-medium ${
                  !showPastGames 
                    ? 'text-indigo-400 border-b-2 border-indigo-500' 
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Available Games
              </button>
              <button
                onClick={() => setShowPastGames(true)}
                className={`py-2 px-4 font-medium ${
                  showPastGames 
                    ? 'text-yellow-400 border-b-2 border-yellow-500' 
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Past Games
              </button>
            </div>

            {!showPastGames ? (
              <div>
                <h3 className="text-lg font-semibold mb-4 text-gray-300">Available Games</h3>
                {availableGames.length === 0 ? (
                  <div className="text-center py-8 bg-gray-800 rounded-lg">
                    <p className="text-gray-400">
                      {currentGame
                        ? 'No other games available. Finish your current game first.'
                        : 'No games available. Create one to start playing!'}
                    </p>
                  </div>
                ) : (
                  availableGames.map(({ id, info }) => renderGameCard(id, info))
                )}
              </div>
            ) : (
              <div>
                <h3 className="text-lg font-semibold mb-4 text-gray-300">Your Past Games</h3>
                {pastGames.length === 0 ? (
                  <div className="text-center py-8 bg-gray-800 rounded-lg">
                    <p className="text-gray-400">
                      You haven't played any games yet that have ended.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {pastGames.map(({ id, info, isWinner, revealedCards }) => 
                      renderPastGameCard(id, info, isWinner, revealedCards)
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}