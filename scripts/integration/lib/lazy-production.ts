import { PRODUCTION_FACTORY_MODULE } from './constants.ts';

/** Tracks whether production factory module was dynamically imported. */
let productionFactoryLoaded = false;

type FactoryLoader = () => Promise<ProductionFactoryModule>;

let injectedLoader: FactoryLoader | null = null;

export const markProductionFactoryLoaded = (): void => {
  productionFactoryLoaded = true;
};

export const wasProductionFactoryLoaded = (): boolean => productionFactoryLoaded;

export const resetProductionFactoryLoadedForTests = (): void => {
  productionFactoryLoaded = false;
  injectedLoader = null;
};

/** Pure-test seam only — not a public runtime authority. */
export const injectProductionFactoryLoaderForTests = (loader: FactoryLoader | null): void => {
  injectedLoader = loader;
};

export type ProductionFactoryModule =
  typeof import('../../../src/host/durable/create-posix-durable-local-host.ts');

const defaultLoader = async (): Promise<ProductionFactoryModule> => {
  markProductionFactoryLoaded();
  // Exact literal module specifier — never caller-controlled.
  return import('../../../src/host/durable/create-posix-durable-local-host.ts');
};

export const loadProductionFactory = async (): Promise<ProductionFactoryModule> => {
  if (injectedLoader !== null) {
    markProductionFactoryLoaded();
    return injectedLoader();
  }
  return defaultLoader();
};

export const productionFactoryModuleSpecifier = (): string => PRODUCTION_FACTORY_MODULE;
