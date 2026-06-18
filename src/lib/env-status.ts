export interface EnvStatus {
  openai: boolean;
  tavily: boolean;
  ready: boolean;
}

export function getEnvStatus(): EnvStatus {
  const openai = Boolean(process.env.OPENAI_API_KEY?.trim());
  const tavily = Boolean(process.env.TAVILY_API_KEY?.trim());
  return {
    openai,
    tavily,
    ready: openai,
  };
}
