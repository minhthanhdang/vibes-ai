export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ProjectState = {
  photographs: number;
  crops: number;
  boards: number;
  generated?: number;
};
