export const logInfo = (message: string, data?: Record<string, unknown>) => {
  console.info(message, data ?? {});
};

export const logWarn = (message: string, data?: Record<string, unknown>) => {
  console.warn(message, data ?? {});
};

export const logError = (message: string, data?: Record<string, unknown>) => {
  console.error(message, data ?? {});
};
