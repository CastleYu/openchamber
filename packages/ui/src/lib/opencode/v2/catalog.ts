import type { OpenCodeClient } from '@opencode/client';
import type { OperationScope, ProviderCatalog } from '../operations';
import type { Agent, Command, Config, McpServerStatus, Project, Skill, Vcs } from '../model';
import { mergeConfigDocuments, projectAgent, projectProject, projectVcs } from '../projection';
import { OpenCodeRuntimeBinding, OpenCodeRuntimeChangedError } from '../runtime';

/** Official OC2 catalog and location calls; no legacy provider/config shape escapes. */
export class V2CatalogOperations {
  constructor(
    private readonly clientFor: (directory?: string | null) => OpenCodeClient,
    private readonly binding: OpenCodeRuntimeBinding,
  ) {}

  location(scope: OperationScope = {}) {
    return this.binding.run('oc2', 'location.get', () =>
      this.clientFor(scope.directory).location.get(undefined, { signal: scope.signal }));
  }

  projects(scope: OperationScope = {}): Promise<Project[]> {
    return this.binding.run('oc2', 'project.list', async () =>
      (await this.clientFor(scope.directory).project.list({ signal: scope.signal })).map(projectProject));
  }

  vcs(scope: OperationScope = {}): Promise<Vcs> {
    return this.binding.run('oc2', 'vcs.get', async () =>
      projectVcs((await this.clientFor(scope.directory).vcs.get(undefined, { signal: scope.signal })).data));
  }

  config(scope: OperationScope = {}): Promise<Config> {
    return this.binding.run('oc2', 'config.get', async () =>
      mergeConfigDocuments(await this.clientFor(scope.directory).config.get(undefined, { signal: scope.signal })));
  }

  catalog(scope: OperationScope = {}): Promise<ProviderCatalog> {
    return this.binding.run('oc2', 'provider/model catalog', async () => {
      const runtime = this.binding.get();
      const client = this.clientFor(scope.directory);
      // The pinned kernel waits for plugin activation in integration.list;
      // provider/model handlers can otherwise return an empty cold registry.
      await client.integration.list(undefined, { signal: scope.signal });
      if (this.binding.get() !== runtime) throw new OpenCodeRuntimeChangedError();
      const [providers, models, selected] = await Promise.all([
        client.provider.list(undefined, { signal: scope.signal }),
        client.model.list(undefined, { signal: scope.signal }),
        client.model.default(undefined, { signal: scope.signal }),
      ]);
      const catalog: ProviderCatalog = {
        generation: 'oc2',
        providers: providers.data,
        models: models.data,
      };
      if (selected.data) catalog.default = { id: selected.data.modelID, providerID: selected.data.providerID };
      return catalog;
    });
  }

  agents(scope: OperationScope = {}): Promise<Agent[]> {
    return this.binding.run('oc2', 'agent.list', async () => {
      const runtime = this.binding.get();
      const client = this.clientFor(scope.directory);
      await client.integration.list(undefined, { signal: scope.signal });
      if (this.binding.get() !== runtime) throw new OpenCodeRuntimeChangedError();
      return (await client.agent.list(undefined, { signal: scope.signal })).data.map(projectAgent);
    });
  }

  commands(scope: OperationScope = {}): Promise<Command[]> {
    return this.binding.run('oc2', 'command.list', async () =>
      (await this.clientFor(scope.directory).command.list(undefined, { signal: scope.signal })).data);
  }

  skills(scope: OperationScope = {}): Promise<Skill[]> {
    return this.binding.run('oc2', 'skill.list', async () =>
      (await this.clientFor(scope.directory).skill.list(undefined, { signal: scope.signal })).data);
  }

  mcp(scope: OperationScope = {}): Promise<McpServerStatus[]> {
    return this.binding.run('oc2', 'mcp.list', async () =>
      (await this.clientFor(scope.directory).mcp.list(undefined, { signal: scope.signal })).data);
  }

  connectMcp(server: string, scope: OperationScope = {}): Promise<void> {
    return this.binding.run('oc2', 'mcp.connect', () =>
      this.clientFor(scope.directory).mcp.connect({ server }, { signal: scope.signal }));
  }

  disconnectMcp(server: string, scope: OperationScope = {}): Promise<void> {
    return this.binding.run('oc2', 'mcp.disconnect', () =>
      this.clientFor(scope.directory).mcp.disconnect({ server }, { signal: scope.signal }));
  }
}
