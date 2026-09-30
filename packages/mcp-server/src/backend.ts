import * as fs from 'fs';

import * as os from 'os';

import * as path from 'path';

import * as net from 'net';

import { evaluateLockFile } from './lock.js';

import { config } from './config.js';

import { Logger } from './logger.js';

import { FoundryClient } from './foundry-client.js';

import { CharacterTools } from './tools/character.js';

import { CompendiumTools } from './tools/compendium.js';

import { SceneTools } from './tools/scene.js';
import { PlaylistTools } from './tools/playlist.js';

import { ActorCreationTools } from './tools/actor-creation.js';
import { ActorManagementTools } from './tools/actor-management.js';
import { EffectManagementTools } from './tools/effect-management.js';

import { QuestCreationTools } from './tools/quest-creation.js';

import { DiceRollTools } from './tools/dice-roll.js';

import { CampaignManagementTools } from './tools/campaign-management.js';

import { OwnershipTools } from './tools/ownership.js';
import { WFRP4eUpdateActorTools } from './tools/wfrp4e/update-actor.js';
import { WFRP4eAddItemsTools } from './tools/wfrp4e/add-items.js';
import { FateUpdateCharacterTools } from './tools/fate/update-character.js';
import { FateRollTools } from './tools/fate/roll.js';
import { FateAspectTools } from './tools/fate/aspects.js';

import { TokenManipulationTools } from './tools/token-manipulation.js';

import { DSA5CharacterCreator } from './systems/dsa5/character-creator.js';

import { DnD5eAddFeatureTool } from './tools/dnd5e/add-feature.js';
import { DnD5eNpcTools } from './tools/dnd5e/npc.js';
import { DnD5eFeaturesFromCompendiumTools } from './tools/dnd5e/features.js';

const CONTROL_HOST = '127.0.0.1';

const CONTROL_PORT = 31414;

const LOCK_FILE = path.join(os.tmpdir(), 'foundry-mcp-backend.lock');

let lockFd: number | null = null;

function acquireLock(): boolean {
  try {
    try {
      lockFd = fs.openSync(LOCK_FILE, 'wx');
    } catch (err: any) {
      if (err && err.code === 'EEXIST') {
        try {
          const lockData = fs.readFileSync(LOCK_FILE, 'utf8');

          const lockPid = parseInt(lockData.trim(), 10);

          try {
            process.kill(lockPid, 0);

            // A process with this PID is alive. Validate it is actually our
            // backend (node.exe / node) and that the lock file is not stale.
            // PID reuse by unrelated OS processes (e.g. GameInputRedistService
            // on Windows) would otherwise cause a false "already running" exit.
            if (evaluateLockFile(lockPid, LOCK_FILE) === 'orphaned') {
              console.error(
                `Removing orphaned backend lock for PID ${lockPid} ` +
                  `(process is not node.exe or lock file is stale)`
              );
              try {
                fs.unlinkSync(LOCK_FILE);
              } catch {}
              lockFd = fs.openSync(LOCK_FILE, 'wx');
            } else {
              // Backend is genuinely running — exit gracefully
              return false;
            }
          } catch {
            console.error(`Removing stale backend lock for PID ${lockPid}`);

            try {
              fs.unlinkSync(LOCK_FILE);
            } catch {}

            lockFd = fs.openSync(LOCK_FILE, 'wx');
          }
        } catch (readErr) {
          console.error('Corrupt backend lock file, removing:', readErr);

          try {
            fs.unlinkSync(LOCK_FILE);
          } catch {}

          lockFd = fs.openSync(LOCK_FILE, 'wx');
        }
      } else {
        console.error('Failed to open backend lock file:', err);

        return false;
      }
    }

    if (lockFd === null) return false;

    fs.writeFileSync(lockFd, String(process.pid));

    try {
      fs.fsyncSync(lockFd);
    } catch {}

    console.error(`Acquired backend lock with PID ${process.pid}`);

    return true;
  } catch (error) {
    console.error('Failed to acquire backend lock:', error);

    return false;
  }
}

function releaseLock(): void {
  try {
    if (lockFd !== null) {
      try {
        fs.closeSync(lockFd);
      } catch {}
      lockFd = null;
    }

    if (fs.existsSync(LOCK_FILE)) {
      try {
        fs.unlinkSync(LOCK_FILE);
      } catch {}
    }
  } catch (error) {
    console.error('Failed to release backend lock:', error);
  }
}

async function startBackend(): Promise<void> {
  // Logger: file output allowed; avoid stdout noise

  const logger = new Logger({
    level: config.logLevel,

    format: config.logFormat,

    enableConsole: false,

    enableFile: true,

    filePath: path.join(os.tmpdir(), 'foundry-mcp-server', 'mcp-server.log'),
  });

  logger.info('Starting Foundry MCP Backend', {
    version: config.server.version,

    foundryHost: config.foundry.host,

    foundryPort: config.foundry.port,
  });

  // Initialize Foundry client and tools

  const foundryClient = new FoundryClient(config.foundry, logger);

  // Initialize system registry and register adapters
  const { getSystemRegistry } = await import('./systems/index.js');
  const { DnD5eAdapter } = await import('./systems/dnd5e/adapter.js');
  const { PF2eAdapter } = await import('./systems/pf2e/adapter.js');
  const { DSA5Adapter } = await import('./systems/dsa5/adapter.js');
  const { CosmereRpgAdapter } = await import('./systems/cosmere-rpg/adapter.js');
  const { WFRP4eAdapter } = await import('./systems/wfrp4e/adapter.js');
  const { MGT2eAdapter } = await import('./systems/mgt2e/adapter.js');
  const { FateCoreOfficialAdapter } = await import('./systems/fate-core-official/adapter.js');

  const systemRegistry = getSystemRegistry(logger);
  systemRegistry.register(new DnD5eAdapter());
  systemRegistry.register(new PF2eAdapter());
  systemRegistry.register(new DSA5Adapter());
  systemRegistry.register(new CosmereRpgAdapter());
  systemRegistry.register(new WFRP4eAdapter());
  systemRegistry.register(new MGT2eAdapter());
  systemRegistry.register(new FateCoreOfficialAdapter());

  logger.info('System registry initialized', {
    supportedSystems: systemRegistry.getSupportedSystems(),
  });

  const characterTools = new CharacterTools({ foundryClient, logger, systemRegistry });

  const compendiumTools = new CompendiumTools({ foundryClient, logger, systemRegistry });

  const sceneTools = new SceneTools({ foundryClient, logger });
  const playlistTools = new PlaylistTools({ foundryClient, logger });

  const actorCreationTools = new ActorCreationTools({ foundryClient, logger });
  const actorManagementTools = new ActorManagementTools({ foundryClient, logger, systemRegistry });
  const effectManagementTools = new EffectManagementTools({ foundryClient, logger });

  const dsa5CharacterCreator = new DSA5CharacterCreator({ foundryClient, logger });

  const dnd5eAddFeatureTool = new DnD5eAddFeatureTool({ foundryClient, logger });
  const dnd5eNpcTools = new DnD5eNpcTools({ foundryClient, logger });
  const dnd5eFeaturesFromCompendiumTools = new DnD5eFeaturesFromCompendiumTools({
    foundryClient,
    logger,
  });

  const questCreationTools = new QuestCreationTools({ foundryClient, logger });

  const diceRollTools = new DiceRollTools({ foundryClient, logger });

  const campaignManagementTools = new CampaignManagementTools(foundryClient, logger);

  const ownershipTools = new OwnershipTools({ foundryClient, logger });

  const tokenManipulationTools = new TokenManipulationTools({ foundryClient, logger });

  const wfrp4eUpdateActorTools = new WFRP4eUpdateActorTools({ foundryClient, logger });
  const wfrp4eAddItemsTools = new WFRP4eAddItemsTools({ foundryClient, logger });

  const fateUpdateCharacterTools = new FateUpdateCharacterTools({ foundryClient, logger });
  const fateRollTools = new FateRollTools({ foundryClient, logger });
  const fateAspectTools = new FateAspectTools({ foundryClient, logger });

  const allTools = [
    ...characterTools.getToolDefinitions(),

    ...compendiumTools.getToolDefinitions(),

    ...sceneTools.getToolDefinitions(),

    ...actorCreationTools.getToolDefinitions(),
    ...actorManagementTools.getToolDefinitions(),
    ...effectManagementTools.getToolDefinitions(),

    ...dsa5CharacterCreator.getToolDefinitions(),

    ...dnd5eAddFeatureTool.getToolDefinitions(),
    ...dnd5eNpcTools.getToolDefinitions(),
    ...dnd5eFeaturesFromCompendiumTools.getToolDefinitions(),

    ...questCreationTools.getToolDefinitions(),

    ...diceRollTools.getToolDefinitions(),

    ...campaignManagementTools.getToolDefinitions(),

    ...ownershipTools.getToolDefinitions(),

    ...wfrp4eUpdateActorTools.getToolDefinitions(),

    ...wfrp4eAddItemsTools.getToolDefinitions(),

    ...fateUpdateCharacterTools.getToolDefinitions(),
    ...fateRollTools.getToolDefinitions(),
    ...fateAspectTools.getToolDefinitions(),

    ...tokenManipulationTools.getToolDefinitions(),

    ...playlistTools.getToolDefinitions(),
  ];

  // Start Foundry connector (owns app port 31415)

  foundryClient.connect().catch(e => {
    logger.error('Foundry connector failed to start', e);
  });

  // Control channel (TCP JSON-lines)

  const server = net.createServer(socket => {
    socket.setEncoding('utf8');

    let buffer = '';

    socket.on('data', async (chunk: string) => {
      buffer += chunk;

      let idx: number;

      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();

        buffer = buffer.slice(idx + 1);

        if (!line) continue;

        try {
          const msg = JSON.parse(line) as { id: string; method: string; params?: any };

          if (msg.method === 'ping') {
            socket.write(JSON.stringify({ id: msg.id, result: { ok: true } }) + '\n');

            continue;
          }

          if (msg.method === 'list_tools') {
            socket.write(JSON.stringify({ id: msg.id, result: { tools: allTools } }) + '\n');

            continue;
          }

          if (msg.method === 'call_tool') {
            const { name, args } = (msg.params || {}) as { name: string; args?: any };

            try {
              let result: any;

              switch (name) {
                // Character tools

                case 'get-character':
                  result = await characterTools.handleGetCharacter(args);

                  break;

                case 'list-characters':
                  result = await characterTools.handleListCharacters(args);

                  break;

                case 'get-character-entity':
                  result = await characterTools.handleGetCharacterEntity(args);

                  break;

                case 'use-item':
                  result = await characterTools.handleUseItem(args);

                  break;

                case 'search-character-items':
                  result = await characterTools.handleSearchCharacterItems(args);

                  break;

                case 'manage-world-items':
                  result = await characterTools.handleManageWorldItems(args);

                  break;

                // Compendium tools

                case 'search-compendium':
                  result = await compendiumTools.handleSearchCompendium(args);

                  break;

                case 'get-compendium-item':
                  result = await compendiumTools.handleGetCompendiumItem(args);

                  break;

                case 'list-creatures-by-criteria':
                  result = await compendiumTools.handleListCreaturesByCriteria(args);

                  break;

                case 'list-compendium-packs':
                  result = await compendiumTools.handleListCompendiumPacks(args);

                  break;

                // Scene tools

                case 'get-current-scene':
                  result = await sceneTools.handleGetCurrentScene(args);

                  break;

                case 'get-world-info':
                  result = await sceneTools.handleGetWorldInfo(args);

                  break;

                // Actor creation tools

                case 'create-actor-from-compendium':
                  result = await actorCreationTools.handleCreateActorFromCompendium(args);

                  break;

                case 'get-compendium-entry-full':
                  result = await actorCreationTools.handleGetCompendiumEntryFull(args);

                  break;

                case 'wfrp4e-update-actor':
                  result = await wfrp4eUpdateActorTools.handleUpdateActor(args);

                  break;

                case 'wfrp4e-add-items':
                  result = await wfrp4eAddItemsTools.handleAddItems(args);

                  break;

                // Fate Core Official tools

                case 'fate-update-character':
                  result = await fateUpdateCharacterTools.handleUpdateCharacter(args);

                  break;

                case 'fate-roll':
                  result = await fateRollTools.handleRoll(args);

                  break;

                case 'fate-manage-aspects':
                  result = await fateAspectTools.handleManageAspects(args);

                  break;

                // Generic actor management (create / update / delete)

                case 'manage-actors':
                  result = await actorManagementTools.handleManageActors(args);

                  break;

                case 'manage-effects':
                  result = await effectManagementTools.handleManageEffects(args);

                  break;

                // DSA5 character creation tools

                case 'create-dsa5-character-from-archetype':
                  result = await dsa5CharacterCreator.handleCreateCharacterFromArchetype(args);

                  break;

                case 'list-dsa5-archetypes':
                  result = await dsa5CharacterCreator.handleListArchetypes(args);

                  break;

                // D&D 5e tools

                case 'dnd5e-add-feature':
                  result = await dnd5eAddFeatureTool.handleAddFeature(args);

                  break;

                case 'dnd5e-create-npc':
                  result = await dnd5eNpcTools.handleCreateNpc(args);

                  break;

                case 'dnd5e-add-features-from-compendium':
                  result =
                    await dnd5eFeaturesFromCompendiumTools.handleAddFeaturesFromCompendium(args);

                  break;

                // Quest creation tools

                case 'create-quest-journal':
                  result = await questCreationTools.handleCreateQuestJournal(args);

                  break;

                case 'link-quest-to-npc':
                  result = await questCreationTools.handleLinkQuestToNPC(args);

                  break;

                case 'update-quest-journal':
                  result = await questCreationTools.handleUpdateQuestJournal(args);

                  break;

                case 'replace-journal-page':
                  result = await questCreationTools.handleReplaceJournalPage(args);

                  break;

                case 'list-journals':
                  result = await questCreationTools.handleListJournals(args);

                  break;

                case 'search-journals':
                  result = await questCreationTools.handleSearchJournals(args);

                  break;

                // Dice roll tools

                case 'request-player-rolls':
                  result = await diceRollTools.handleRequestPlayerRolls(args);

                  break;

                // Campaign management tools

                case 'create-campaign-dashboard':
                  result = await campaignManagementTools.handleCreateCampaignDashboard(args);

                  break;

                // Ownership tools

                case 'assign-actor-ownership':
                  result = await ownershipTools.handleToolCall('assign-actor-ownership', args);

                  break;

                case 'remove-actor-ownership':
                  result = await ownershipTools.handleToolCall('remove-actor-ownership', args);

                  break;

                case 'list-actor-ownership':
                  result = await ownershipTools.handleToolCall('list-actor-ownership', args);

                  break;

                // Token manipulation tools

                case 'move-token':
                  result = await tokenManipulationTools.handleMoveToken(args);

                  break;

                case 'update-token':
                  result = await tokenManipulationTools.handleUpdateToken(args);

                  break;

                case 'delete-tokens':
                  result = await tokenManipulationTools.handleDeleteTokens(args);

                  break;

                case 'get-token-details':
                  result = await tokenManipulationTools.handleGetTokenDetails(args);

                  break;

                case 'toggle-token-condition':
                  result = await tokenManipulationTools.handleToggleTokenCondition(args);

                  break;

                case 'get-available-conditions':
                  result = await tokenManipulationTools.handleGetAvailableConditions(args);

                  break;

                case 'list-scenes':
                  result = await sceneTools.handleListScenes(args);

                  break;

                case 'switch-scene':
                  result = await sceneTools.handleSwitchScene(args);

                  break;

                // Playlist management tools

                case 'manage-playlists':
                  result = await playlistTools.handleManagePlaylists(args);

                  break;

                case 'control-playlist':
                  result = await playlistTools.handleControlPlaylist(args);

                  break;

                case 'update-scene-music':
                  result = await sceneTools.handleUpdateSceneMusic(args);

                  break;

                default:
                  throw new Error(`Unknown tool: ${name}`);
              }

              const payload = {
                content: [
                  {
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(result),
                  },
                ],
              };

              socket.write(JSON.stringify({ id: msg.id, result: payload }) + '\n');
            } catch (e: any) {
              const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';

              socket.write(
                JSON.stringify({
                  id: msg.id,
                  result: {
                    content: [{ type: 'text', text: `Error: ${errorMessage}` }],
                    isError: true,
                  },
                }) + '\n'
              );
            }

            continue;
          }

          // Unknown method

          socket.write(JSON.stringify({ id: msg.id, error: { message: 'Unknown method' } }) + '\n');
        } catch (e: any) {
          try {
            socket.write(
              JSON.stringify({ error: { message: e?.message || 'Bad request' } }) + '\n'
            );
          } catch {}
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(CONTROL_PORT, CONTROL_HOST, () => {
      logger.info(`Backend control channel listening on ${CONTROL_HOST}:${CONTROL_PORT}`);

      resolve();
    });

    server.on('error', reject);
  });

  // Shutdown hooks

  process.on('SIGINT', () => {
    foundryClient.disconnect();
    releaseLock();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    foundryClient.disconnect();
    releaseLock();
    process.exit(0);
  });
}

// Check lock BEFORE any async operations
// If another instance is running, wait forever silently (don't exit)
// This prevents Claude Desktop from seeing a "server closed" error
const hasLock = acquireLock();

(async function main() {
  if (!hasLock) {
    // Another backend is running - wait forever without doing anything
    // This keeps the process alive so Claude doesn't see an error
    await new Promise(() => {}); // Never resolves
    return;
  }

  process.on('exit', releaseLock);

  try {
    await startBackend();
  } catch (e: any) {
    console.error('Failed to start backend:', e?.message || e);

    releaseLock();

    process.exit(1);
  }
})();
