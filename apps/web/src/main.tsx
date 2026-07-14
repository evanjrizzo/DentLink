import { createRoot } from "react-dom/client";

import { DentLinkNotesApp } from "./notes-app";
import "./styles.css";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<DentLinkNotesApp />);
}
