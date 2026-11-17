declare module "react-syntax-highlighter" {
  import type { ComponentType, CSSProperties } from "react";

  export const Prism: ComponentType<{
    children?: string;
    customStyle?: CSSProperties;
    language?: string;
    showLineNumbers?: boolean;
    style?: Record<string, CSSProperties>;
  }>;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  import type { CSSProperties } from "react";

  export const oneDark: Record<string, CSSProperties>;
}
