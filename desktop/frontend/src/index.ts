import "./styles.css";
import "./jellyfin-parity.css";
import {mount} from "svelte";
import App from "./App.svelte";

// Packaged locally by Tauri. No Jellyfin Web, iframe, injected React
// application or imported Jellyfin skin is ever executed here.
mount(App, {target:document.getElementById("app")!});
