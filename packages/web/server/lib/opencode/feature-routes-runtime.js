import { registerFsRoutes } from '../fs/routes.js';
import { registerPerformanceRoutes } from '../performance/collector.js';
import { registerResourceModeRoutes } from '../mcp-reconnect/resource-modes.js';
import { registerQuotaRoutes } from '../quota/routes.js';
import { registerSmallModelRoutes } from '../small-model/routes.js';
import { registerWalkthroughRoutes } from '../walkthrough/routes.js';
import { registerSessionGoalRoutes } from '../session-goal/routes.js';
import { registerGitHubRoutes } from '../github/routes.js';
import { registerLinearRoutes } from '../linear/routes.js';
import { registerGuestRoutes } from '../guests/routes.js';
import { registerBuiltInGuests } from '../guests/catalog.js';
import { extensionsPersistPath } from '../guests/persist.js';
import { registerGitRoutes } from '../git/routes.js';
import { registerDevServerRoutes } from '../dev-servers/routes.js';
import { registerMagicPromptRoutes } from '../magic-prompts/routes.js';
import { registerSessionFoldersRoutes } from '../session-folders/routes.js';
import { registerLogsRoutes } from '../logs/routes.js';
import { registerProjectContextRoutes } from '../project-context/routes.js';
import { registerProjectSetupRoutes } from '../projects/routes.js';
import { registerAgentMemoryRoutes } from '../agent-memory/routes.js';
import { registerSessionKnowledgeRoutes } from '../session-knowledge/routes.js';
import { registerPermissionAutoAcceptRoutes } from '../permission-auto-accept/runtime.js';
import { registerMessageQueueRoutes } from '../message-queue/runtime.js';
import { registerRoutingPromptRewrite, registerRoutingRoutes } from '../routing/routes.js';
import { registerConfigEntityRoutes } from './config-entity-routes.js';
import { registerSettingsUtilityRoutes } from './core-routes.js';
import { registerProjectIconRoutes } from './project-icon-routes.js';
import { registerScheduledTaskRoutes } from '../scheduled-tasks/routes.js';
import { registerOpenChamberSessionRoutes } from '../openchamber-sessions/routes.js';
import { registerOpenChamberControlRoutes } from '../openchamber-control/routes.js';
import { registerMarkdownImageGrantRoutes } from '../markdown-image-grants/routes.js';
import { registerSkillRoutes } from './skill-routes.js';
import { registerPluginRoutes } from './plugin-routes.js';
import { getNpmInfo, clearCache as clearNpmCache } from './npm-registry.js';
import { parseNpmSpec, parsePathSpec, isExactSemver } from './plugin-spec.js';
import { registerOpenCodeRoutes } from './routes.js';
import { getProviderSources, removeProviderConfig, upsertProviderConfig } from './providers.js';
import * as providersV2 from './providers-v2.js';
import { getAgentSources, getAgentConfig, createAgent, updateAgent, deleteAgent } from './agents.js';
import * as agentsV2 from './agents-v2.js';
import { getCommandSources, createCommand, updateCommand, deleteCommand } from './commands.js';
import * as commandsV2 from './commands-v2.js';
import { listMcpConfigs, getMcpConfig, createMcpConfig, updateMcpConfig, deleteMcpConfig } from './mcp.js';
import * as mcpV2 from './mcp-v2.js';
import { listSnippets, getSnippet, createSnippet, updateSnippet, deleteSnippet, expandSnippets } from './snippets.js';
import {
  listPluginEntries,
  getPluginEntry,
  createPluginEntry,
  updatePluginEntry,
  deletePluginEntry,
  listPluginDirFiles,
  readPluginDirFile,
  writePluginDirFile,
  deletePluginDirFile,
  encodePluginId,
  decodePluginId,
} from './plugins.js';
import * as pluginsV2 from './plugins-v2.js';
import { SKILL_DIR, SKILL_SCOPE, readSkillSupportingFile, writeSkillSupportingFile, deleteSkillSupportingFile } from './shared.js';
import { getSkillSources, discoverSkills, mergeDiscoveredSkills, createSkill, updateSkill, deleteSkill, renameSkill, isManagedSkillPath } from './skills.js';
import { getCuratedSkillsSources } from '../skills-catalog/curated-sources.js';
import { getCacheKey, scanWithCache } from '../skills-catalog/cache.js';
import { parseSkillRepoSource } from '../skills-catalog/source.js';
import { scanSkillsRepository } from '../skills-catalog/scan.js';
import { installSkillsFromRepository } from '../skills-catalog/install.js';
import { fetchGitHubRepoMetas } from '../skills-catalog/github-meta.js';

export const createFeatureRoutesRuntime = (dependencies) => {
  const {
    clientReloadDelayMs,
  } = dependencies;

  let quotaProviders = null;
  const getQuotaProviders = async () => {
    if (!quotaProviders) {
      quotaProviders = await import('../quota/index.js');
    }
    return quotaProviders;
  };

  let smallModelService = null;
  const getSmallModelService = async () => {
    if (!smallModelService) {
      smallModelService = await import('../small-model/index.js');
    }
    return smallModelService;
  };

  let walkthroughService = null;
  const getWalkthroughService = async () => {
    if (!walkthroughService) {
      const [service, pullRequest] = await Promise.all([
        import('../walkthrough/index.js'),
        import('../walkthrough/pull-request.js'),
      ]);
      walkthroughService = {
        ...service,
        getPullRequestDiff: pullRequest.getPullRequestDiff,
      };
    }
    return walkthroughService;
  };

  const registerRoutes = async (app, routeDependencies) => {
    const {
      crypto,
      fs,
      os,
      path,
      fsPromises,
      spawn,
      resolveGitBinaryForSpawn,
      createFsSearchRuntime,
      openchamberDataDir,
      runtimeLog,
      onGuestDeactivated,
      openchamberUserConfigRoot,
      managedChatsRoot,
      normalizeDirectoryPath,
      resolveProjectDirectory,
      resolveOptionalProjectDirectory,
      validateDirectoryPath,
      readCustomThemesFromDisk,
      saveImportedTheme,
      deleteImportedTheme,
      refreshOpenCodeAfterConfigChange,
      getOpenCodeResolutionSnapshot,
      getOpenCodeUpgradeCapability,
      upgradeOpenCodeCli,
      formatSettingsResponse,
      readSettingsFromDisk,
      readSettingsFromDiskMigrated,
      persistSettings,
      sanitizeProjects,
      sanitizeSkillCatalogs,
      isUnsafeSkillRelativePath,
      buildOpenCodeUrl,
      getOpenCodeAuthHeaders,
      getOpenCodePort,
      kernelRuntime,
      getOwnPorts,
      devServerScanner,
      buildAugmentedPath,
      projectConfigRuntime,
      projectContextRuntime,
      agentMemoryRuntime,
      isAgentMemoryEnabled,
      sessionKnowledgeRuntime,
      scheduledTasksRuntime,
      scheduledTaskService,
      openChamberSessionService,
      openChamberControlService,
      waitForOpenCodeReady,
      getOpenChamberEventClients,
      writeSseEvent,
      emitSessionCreatedEvent,
      permissionAutoAcceptRuntime,
      messageQueueRuntime,
      routingRuntime,
      openchamberVersion,
    } = routeDependencies;

    registerSettingsUtilityRoutes(app, {
      readCustomThemesFromDisk,
      saveImportedTheme,
      deleteImportedTheme,
      refreshOpenCodeAfterConfigChange,
      clientReloadDelayMs,
    });

    registerPermissionAutoAcceptRoutes(app, permissionAutoAcceptRuntime);
    registerMessageQueueRoutes(app, messageQueueRuntime);
    registerRoutingRoutes(app, routingRuntime);
    // Before the generic OpenCode proxy: turns `openchamber/auto` into a real model.
    registerRoutingPromptRewrite(app, routingRuntime);

    registerOpenCodeRoutes(app, {
      kernelRuntime,
      crypto,
      clientReloadDelayMs,
      getOpenCodeResolutionSnapshot,
      getOpenCodeUpgradeCapability,
      upgradeOpenCodeCli,
      formatSettingsResponse,
      readSettingsFromDisk,
      readSettingsFromDiskMigrated,
      persistSettings,
      sanitizeProjects,
      validateDirectoryPath,
      resolveProjectDirectory,
      getProviderSources: (...args) => {
        const active = kernelRuntime.get().generation;
        if (active === 'oc1') return getProviderSources(...args);
        if (active === 'oc2') return providersV2.getProviderSources(...args);
        throw new Error('OpenCode generation is not ready for provider configuration');
      },
      removeProviderConfig: (...args) => {
        const active = kernelRuntime.get().generation;
        if (active === 'oc1') return removeProviderConfig(...args);
        if (active === 'oc2') return providersV2.removeProviderConfig(...args);
        throw new Error('OpenCode generation is not ready for provider configuration');
      },
      upsertProviderConfig: (...args) => {
        const active = kernelRuntime.get().generation;
        if (active === 'oc1') return upsertProviderConfig(...args);
        if (active === 'oc2') return providersV2.upsertProviderConfig(...args);
        throw new Error('OpenCode generation is not ready for provider configuration');
      },
      refreshOpenCodeAfterConfigChange,
      buildOpenCodeUrl,
      getOpenCodeAuthHeaders,
    });

    registerProjectIconRoutes(app, {
      fsPromises,
      path,
      crypto,
      openchamberDataDir,
      sanitizeProjects,
      readSettingsFromDiskMigrated,
      persistSettings,
      createFsSearchRuntime,
      spawn,
      resolveGitBinaryForSpawn,
    });

    registerScheduledTaskRoutes(app, {
      readSettingsFromDiskMigrated,
      sanitizeProjects,
      projectConfigRuntime,
      scheduledTasksRuntime,
      scheduledTaskService,
      getOpenChamberEventClients,
      writeSseEvent,
    });

    registerOpenChamberSessionRoutes(app, {
      readSettingsFromDiskMigrated,
      sanitizeProjects,
      validateDirectoryPath,
      buildOpenCodeUrl,
      getOpenCodeAuthHeaders,
      waitForOpenCodeReady,
      emitSessionCreatedEvent,
      sessionService: openChamberSessionService,
    });

    registerOpenChamberControlRoutes(app, { controlService: openChamberControlService });

    registerMarkdownImageGrantRoutes(app, {
      fsPromises,
      path,
      os,
      crypto,
      validateDirectoryPath,
      buildOpenCodeUrl,
      getOpenCodeAuthHeaders,
    });

    const generation = () => kernelRuntime.get().generation;
    const choose = (legacy, current) => (...args) => {
      const active = generation();
      if (active === 'oc1') return legacy(...args);
      if (active === 'oc2') return current(...args);
      throw new Error('OpenCode generation is not ready for configuration access');
    };
    for (const segment of ['agents', 'commands', 'mcp']) {
      app.use(`/api/config/${segment}`, (_req, res, next) => {
        if (generation() !== 'oc1' && generation() !== 'oc2') return res.status(503).json({ error: 'OpenCode generation is not ready' });
        return next();
      });
    }
    registerConfigEntityRoutes(app, {
      getGeneration: generation,
      resolveProjectDirectory,
      resolveOptionalProjectDirectory,
      refreshOpenCodeAfterConfigChange,
      clientReloadDelayMs,
      getAgentSources: choose(getAgentSources, agentsV2.getAgentSources),
      getAgentConfig: choose(getAgentConfig, agentsV2.getAgentConfig),
      getAgentPermissions: agentsV2.getAgentPermissions,
      createAgent: choose(createAgent, agentsV2.createAgent),
      updateAgent: choose(updateAgent, agentsV2.updateAgent),
      deleteAgent: choose(deleteAgent, agentsV2.deleteAgent),
      getCommandSources: choose(getCommandSources, commandsV2.getCommandSources),
      getCommandConfig: commandsV2.getCommandConfig,
      createCommand: choose(createCommand, commandsV2.createCommand),
      updateCommand: choose(updateCommand, commandsV2.updateCommand),
      deleteCommand: choose(deleteCommand, commandsV2.deleteCommand),
      listMcpConfigs: choose(listMcpConfigs, mcpV2.listMcpConfigs),
      getMcpConfig: choose(getMcpConfig, mcpV2.getMcpConfig),
      createMcpConfig: choose(createMcpConfig, mcpV2.createMcpConfig),
      updateMcpConfig: choose(updateMcpConfig, mcpV2.updateMcpConfig),
      deleteMcpConfig: choose(deleteMcpConfig, mcpV2.deleteMcpConfig),
      listSnippets,
      getSnippet,
      createSnippet,
      updateSnippet,
      deleteSnippet,
      expandSnippets,
    });

    const selectPluginOperation = (legacy, current) => (...args) => {
      const generation = kernelRuntime.get().generation;
      if (generation === 'oc1') return legacy(...args);
      if (generation === 'oc2') return current(...args);
      throw Object.assign(new Error('OpenCode generation is not ready for plugin configuration'), { statusCode: 503 });
    };
    registerPluginRoutes(app, {
      getKernelRuntime: () => kernelRuntime.get(),
      resolveOptionalProjectDirectory,
      refreshOpenCodeAfterConfigChange,
      clientReloadDelayMs,
      listPluginEntries: selectPluginOperation(listPluginEntries, pluginsV2.listPluginEntries),
      getPluginEntry: selectPluginOperation(getPluginEntry, pluginsV2.getPluginEntry),
      createPluginEntry: selectPluginOperation(createPluginEntry, pluginsV2.createPluginEntry),
      updatePluginEntry: selectPluginOperation(updatePluginEntry, pluginsV2.updatePluginEntry),
      deletePluginEntry: selectPluginOperation(deletePluginEntry, pluginsV2.deletePluginEntry),
      listPluginDirFiles: selectPluginOperation(listPluginDirFiles, pluginsV2.listPluginDirFiles),
      readPluginDirFile: selectPluginOperation(readPluginDirFile, pluginsV2.readPluginDirFile),
      writePluginDirFile: selectPluginOperation(writePluginDirFile, pluginsV2.writePluginDirFile),
      deletePluginDirFile: selectPluginOperation(deletePluginDirFile, pluginsV2.deletePluginDirFile),
      encodePluginId,
      decodePluginId,
      getNpmInfo,
      parseNpmSpec,
      parsePathSpec,
      isExactSemver,
    });

    const { getProfiles, getProfile } = await import('../git/index.js');

    registerSkillRoutes(app, {
      kernelRuntime,
      fs,
      path,
      os,
      resolveProjectDirectory,
      resolveOptionalProjectDirectory,
      readSettingsFromDisk,
      sanitizeSkillCatalogs,
      isUnsafeSkillRelativePath,
      refreshOpenCodeAfterConfigChange,
      clientReloadDelayMs,
      buildOpenCodeUrl,
      getOpenCodeAuthHeaders,
      getOpenCodePort,
      getSkillSources,
      discoverSkills,
      mergeDiscoveredSkills,
      createSkill,
      updateSkill,
      deleteSkill,
      renameSkill,
      isManagedSkillPath,
      readSkillSupportingFile,
      writeSkillSupportingFile,
      deleteSkillSupportingFile,
      SKILL_SCOPE,
      SKILL_DIR,
      getCuratedSkillsSources,
      getCacheKey,
      scanWithCache,
      parseSkillRepoSource,
      scanSkillsRepository,
      installSkillsFromRepository,
      fetchGitHubRepoMetas,
      getProfiles,
      getProfile,
    });

    registerQuotaRoutes(app, { getQuotaProviders });
    registerPerformanceRoutes(app);
    registerResourceModeRoutes(app);
    registerSmallModelRoutes(app, { getSmallModelService });
    registerWalkthroughRoutes(app, { getWalkthroughService });
    registerSessionGoalRoutes(app);
    registerGitHubRoutes(app);
    registerLinearRoutes(app);
    await registerBuiltInGuests({ persistPath: extensionsPersistPath(openchamberDataDir), root: routeDependencies.builtInExtensionsDir });
    registerGuestRoutes(app, { openchamberDataDir, openchamberVersion, resolveGitBinaryForSpawn, resolveOptionalProjectDirectory, getSmallModelService, onGuestDeactivated });
    registerGitRoutes(app, {
      emitWorktreeChanged: ({ directories, at }) => {
        const clients = getOpenChamberEventClients();
        for (const client of clients) {
          try {
            writeSseEvent(client, {
              type: 'openchamber:worktree-changed',
              properties: { directories, at },
            });
          } catch {
            clients.delete(client);
          }
        }
      },
    });
    registerDevServerRoutes(app, { scanner: devServerScanner, getOwnPorts });
    registerMagicPromptRoutes(app, {
      fsPromises,
      path,
      openchamberDataDir,
    });
    registerProjectContextRoutes(app, { projectContextRuntime });
    registerProjectSetupRoutes(app, { projectConfigRuntime });
    registerAgentMemoryRoutes(app, { agentMemoryRuntime, isAgentMemoryEnabled });
    registerSessionKnowledgeRoutes(app, { sessionKnowledgeRuntime });

    registerSessionFoldersRoutes(app, {
      fsPromises,
      path,
      openchamberDataDir,
    });
    registerLogsRoutes(app, { runtimeLog });
    registerFsRoutes(app, {
      os,
      path,
      fsPromises,
      spawn,
      crypto,
      normalizeDirectoryPath,
      resolveProjectDirectory,
      buildAugmentedPath,
      resolveGitBinaryForSpawn,
      openchamberUserConfigRoot,
      managedChatsRoot,
    });
  };

  return {
    registerRoutes,
  };
};
