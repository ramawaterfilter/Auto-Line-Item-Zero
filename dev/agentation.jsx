import React from "react";
import { createRoot } from "react-dom/client";
import { Agentation } from "agentation";

if (process.env.NODE_ENV === "development") {
  createRoot(document.getElementById("agentation-root")).render(<Agentation />);
}
