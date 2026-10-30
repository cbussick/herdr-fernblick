import { createRoot } from "react-dom/client";
import "@fontsource/nunito/latin-400.css";
import "@fontsource/nunito/latin-600.css";
import "@fontsource/nunito/latin-700.css";
import "@xyflow/react/dist/style.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
