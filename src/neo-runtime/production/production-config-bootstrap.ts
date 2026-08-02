import type { CreatePosixDurableLocalHostInput } from '../../host/durable/create-posix-durable-local-host.js';
import { parseLocalHostConfig } from '../../host/config/parse-local-host-config.js';
import { parseStorageBindingRequest } from '../../host/storage/parse-storage-binding-request.js';
import { parsePosixStorageRootPolicy } from '../../host/storage/runtime/posix-storage-root-policy.js';
import type { ClockPort } from '../../core/ports/clock.port.js';
import type {
  NeoProcessConfigFileReaderPort,
  NeoProcessConfigFileReadResult,
} from '../ports/neo-process-ports.js';

export type ProductionConfigBootstrapInput = {
  readonly configPath: string;
  readonly storageBindingPath: string;
  readonly storagePolicyPath: string;
  readonly clock: ClockPort;
};

export type ProductionConfigBootstrapResult =
  | { readonly ok: true; readonly compositionInput: CreatePosixDurableLocalHostInput }
  | { readonly ok: false; readonly reason: string };

const readRequired = async (
  reader: NeoProcessConfigFileReaderPort,
  path: string,
): Promise<NeoProcessConfigFileReadResult> => reader.readJsonFile(path);

export const bootstrapProductionConfig = async (
  reader: NeoProcessConfigFileReaderPort,
  input: ProductionConfigBootstrapInput,
): Promise<ProductionConfigBootstrapResult> => {
  const configFile = await readRequired(reader, input.configPath);
  if (!configFile.ok) return { ok: false, reason: 'Local host config file is invalid.' };

  const bindingFile = await readRequired(reader, input.storageBindingPath);
  if (!bindingFile.ok) return { ok: false, reason: 'Storage binding config file is invalid.' };

  const policyFile = await readRequired(reader, input.storagePolicyPath);
  if (!policyFile.ok) return { ok: false, reason: 'Storage policy config file is invalid.' };

  const parsedConfig = parseLocalHostConfig(configFile.json);
  if (!parsedConfig.ok) return { ok: false, reason: 'Local host config validation failed.' };

  const binding = parseStorageBindingRequest(bindingFile.json);
  if (!binding.ok) return { ok: false, reason: 'Storage binding validation failed.' };

  const policy = parsePosixStorageRootPolicy(policyFile.json);
  if (!policy.ok) return { ok: false, reason: 'Storage policy validation failed.' };

  return {
    ok: true,
    compositionInput: {
      config: configFile.json,
      storageBinding: bindingFile.json,
      storagePolicy: policyFile.json,
      host: {
        clock: input.clock,
      },
    },
  };
};
