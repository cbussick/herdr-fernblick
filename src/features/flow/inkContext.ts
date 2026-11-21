import { createContext } from "react";

export const InkContext = createContext({
  hidden: new Set<string>(),
  start: (_id: string) => {},
  finish: (_id: string) => {},
});
