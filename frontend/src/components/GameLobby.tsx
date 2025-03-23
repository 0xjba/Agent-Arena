import React, { useEffect, useState } from 'react';
import { Plus, Users, Clock, ArrowRight } from 'lucide-react';
import { createGame, joinGame, getGameInfo, GameInfo, GameState, getCurrentGameId, getPlayers } from '../lib/contract';
import toast from 'react-hot-toast';

interface GameLobbyProps {
  onGameJoin: (gameId: number) => void;
  playerAddress: string;
  isContractInitialized: boolean;
}

export function GameLobby({ onGameJoin, playerAddress, isContractInitialized }: GameLobbyProps) {
  const [availableGames, setAvailableGames] = useState<{ id: number; info: GameInfo }[]>([]);
  const [currentGame, setCurrentGame] = useState<{ id: number; info: GameInfo } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isContractInitialized) {
      pollGames();
      const interval = setInterval(pollGames, 5000);
      return () => clearInterval(interval);
    }
  }, [isContractInitialized, playerAddress]);

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
          </>
        )}
      </div>
    </div>
  );
}