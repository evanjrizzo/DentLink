use std::process::Command;

use gdk::prelude::MonitorExt;
use gtk::glib::{timeout_add_seconds_local, ControlFlow, Propagation};
use gtk::prelude::{GtkWindowExt, WidgetExt, WidgetExtManual};
use serde::Serialize;
use tauri::{Manager, PhysicalPosition, PhysicalSize, Position, Size};

#[derive(Serialize)]
struct MacroContext {
    active: bool,
    apps: Vec<String>,
    muted: bool,
    error: String,
}

#[derive(Serialize)]
struct MacroResult {
    ok: bool,
    message: String,
}

#[tauri::command]
fn macro_context() -> MacroContext {
    let mut context = detect_voice_call();
    context.muted = default_source_muted();
    context
}

#[tauri::command]
fn run_macro(action: String) -> MacroResult {
    match action.trim() {
        "mute_toggle" => run_status(
            Command::new("pactl")
                .args(["set-source-mute", "@DEFAULT_SOURCE@", "toggle"])
                .status(),
            "Microphone mute toggled",
            "Microphone toggle failed",
        ),
        "voice_fx_toggle" => toggle_voice_fx(),
        "open_files" => run_status(
            Command::new("sh")
                .args(["-lc", "cosmic-files ~ || xdg-open ~"])
                .status(),
            "Files opened",
            "Could not open Files",
        ),
        "command:scrcpy" => spawn_detached("scrcpy", &[], "Phone launched"),
        "command:cosmic-term" => spawn_detached("cosmic-term", &[], "Terminal launched"),
        "refresh" | "history" | "settings" | "rerank" => MacroResult {
            ok: true,
            message: "Handled in DentLink".to_string(),
        },
        other => MacroResult {
            ok: false,
            message: format!("Unknown macro action: {other}"),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![macro_context, run_macro])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                lock_window_to_touchscreen(&window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DentLink desktop");
}

fn lock_window_to_touchscreen(window: &tauri::WebviewWindow) {
    let target = window
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors
                .into_iter()
                .min_by_key(|monitor| monitor.size().width.saturating_mul(monitor.size().height))
        })
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.app_handle().primary_monitor().ok().flatten());

    let _ = window.set_decorations(false);
    let _ = window.set_fullscreen(false);

    if let Some(target) = target {
        let position = target.position();
        let size = target.size();
        let _ = window.set_size(Size::Physical(PhysicalSize {
            width: size.width,
            height: size.height,
        }));
        let _ = window.set_position(Position::Physical(PhysicalPosition {
            x: position.x,
            y: position.y,
        }));
    }

    configure_gtk_touchscreen_window(window);
}

fn configure_gtk_touchscreen_window(window: &tauri::WebviewWindow) {
    let Ok(gtk_window) = window.gtk_window() else {
        return;
    };

    gtk_window.set_decorated(false);
    gtk_window.set_accept_focus(true);
    gtk_window.set_focus_on_map(true);
    gtk_window.set_keep_above(false);
    gtk_window.set_skip_taskbar_hint(false);
    gtk_window.set_skip_pager_hint(false);
    gtk_window.set_type_hint(gdk::WindowTypeHint::Normal);
    let gtk_window_for_realize = gtk_window.clone();
    gtk_window.connect_realize(move |_| apply_gtk_monitor_fill(&gtk_window_for_realize));
    let gtk_window_for_map = gtk_window.clone();
    gtk_window.connect_map_event(move |_, _| {
        apply_gtk_monitor_fill(&gtk_window_for_map);
        Propagation::Proceed
    });
    let gtk_window_for_retry = gtk_window.clone();
    timeout_add_seconds_local(1, move || {
        apply_gtk_monitor_fill(&gtk_window_for_retry);
        ControlFlow::Break
    });
    apply_gtk_monitor_fill(&gtk_window);
}

fn apply_gtk_monitor_fill(gtk_window: &gtk::ApplicationWindow) {
    let Some(display) = gdk::Display::default() else {
        gtk_window.fullscreen();
        return;
    };

    let target_monitor = (0..display.n_monitors()).min_by_key(|monitor_index| {
        display
            .monitor(*monitor_index)
            .map(|monitor| {
                let geometry = monitor.geometry();
                geometry.width().saturating_mul(geometry.height())
            })
            .unwrap_or(i32::MAX)
    });

    if let Some(monitor_index) = target_monitor {
        if let Some(monitor) = display.monitor(monitor_index) {
            let geometry = monitor.geometry();
            gtk_window.set_default_size(geometry.width(), geometry.height());
            gtk_window.set_size_request(geometry.width(), geometry.height());
            gtk_window.resize(geometry.width(), geometry.height());
            gtk_window.move_(geometry.x(), geometry.y());
            if let Some(screen) = GtkWindowExt::screen(gtk_window) {
                gtk_window.fullscreen_on_monitor(&screen, monitor_index);
            } else {
                gtk_window.fullscreen();
            }
        } else {
            gtk_window.fullscreen();
        }
    } else {
        gtk_window.fullscreen();
    }
}

fn detect_voice_call() -> MacroContext {
    let output = match Command::new("pactl")
        .args(["list", "source-outputs"])
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            return MacroContext {
                active: false,
                apps: Vec::new(),
                muted: false,
                error: error.to_string(),
            };
        }
    };
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let mut apps = Vec::new();
    for line in text.lines() {
        if !line.contains("application.name")
            && !line.contains("media.name")
            && !line.contains("application.process.binary")
        {
            continue;
        }
        let value = line
            .split_once('=')
            .map(|(_, value)| value.trim().trim_matches('"').to_string())
            .unwrap_or_default();
        let lower = value.to_lowercase();
        let likely_call = [
            "discord", "zoom", "teams", "slack", "webex", "meet", "jitsi", "signal", "telegram",
            "element", "skype", "firefox", "chrome", "chromium", "brave",
        ]
        .iter()
        .any(|needle| lower.contains(needle));
        if likely_call && !apps.iter().any(|app| app == &value) {
            apps.push(value);
        }
    }
    MacroContext {
        active: !apps.is_empty(),
        apps,
        muted: false,
        error: String::new(),
    }
}

fn default_source_muted() -> bool {
    let output = Command::new("pactl")
        .args(["get-source-mute", "@DEFAULT_SOURCE@"])
        .output();
    output
        .ok()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .to_lowercase()
                .contains("yes")
        })
        .unwrap_or(false)
}

fn toggle_voice_fx() -> MacroResult {
    let Some(base) = easy_effects_command() else {
        return MacroResult {
            ok: false,
            message: "Install EasyEffects for Voice FX".to_string(),
        };
    };
    configure_easy_effects_voice_filter();
    let status = Command::new(&base[0])
        .args(&base[1..])
        .args(["--bypass", "3"])
        .output()
        .ok()
        .and_then(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .rev()
                .find_map(|line| match line.trim() {
                    "0" => Some(0),
                    "1" => Some(1),
                    _ => None,
                })
        });
    let next = if status == Some(0) { "1" } else { "0" };
    let toggled = Command::new(&base[0])
        .args(&base[1..])
        .args(["--bypass", "1", next])
        .status();
    if toggled.map(|status| status.success()).unwrap_or(false) {
        if next == "0" {
            let _ = Command::new(&base[0])
                .args(&base[1..])
                .args(["--load-preset", "voice-change"])
                .status();
            MacroResult {
                ok: true,
                message: "Voice FX on".to_string(),
            }
        } else {
            MacroResult {
                ok: true,
                message: "Voice FX off".to_string(),
            }
        }
    } else {
        MacroResult {
            ok: false,
            message: "Voice FX failed".to_string(),
        }
    }
}

fn easy_effects_command() -> Option<Vec<String>> {
    if command_exists("easyeffects") {
        return Some(vec!["easyeffects".to_string()]);
    }
    if command_exists("flatpak") {
        let installed = Command::new("flatpak")
            .args(["info", "com.github.wwmm.easyeffects"])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if installed {
            return Some(vec![
                "flatpak".to_string(),
                "run".to_string(),
                "com.github.wwmm.easyeffects".to_string(),
            ]);
        }
    }
    None
}

fn configure_easy_effects_voice_filter() {
    let commands: &[&[&str]] = &[
        &[
            "set",
            "com.github.wwmm.easyeffects",
            "process-all-inputs",
            "true",
        ],
        &[
            "set",
            "com.github.wwmm.easyeffects.streaminputs",
            "plugins",
            "['pitch']",
        ],
        &[
            "set",
            "com.github.wwmm.easyeffects.pitch:/com/github/wwmm/easyeffects/streaminputs/pitch/",
            "semitones",
            "-4.0",
        ],
        &[
            "set",
            "com.github.wwmm.easyeffects.pitch:/com/github/wwmm/easyeffects/streaminputs/pitch/",
            "quick-seek",
            "true",
        ],
        &[
            "set",
            "com.github.wwmm.easyeffects.pitch:/com/github/wwmm/easyeffects/streaminputs/pitch/",
            "anti-alias",
            "true",
        ],
        &[
            "set",
            "com.github.wwmm.easyeffects.pitch:/com/github/wwmm/easyeffects/streaminputs/pitch/",
            "bypass",
            "false",
        ],
    ];
    for args in commands {
        let _ = Command::new("gsettings").args(*args).status();
    }
}

fn command_exists(command: &str) -> bool {
    Command::new("sh")
        .args(["-lc", &format!("command -v {command} >/dev/null 2>&1")])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn spawn_detached(command: &str, args: &[&str], message: &str) -> MacroResult {
    match Command::new(command).args(args).spawn() {
        Ok(_) => MacroResult {
            ok: true,
            message: message.to_string(),
        },
        Err(error) => MacroResult {
            ok: false,
            message: error.to_string(),
        },
    }
}

fn run_status(
    status: std::io::Result<std::process::ExitStatus>,
    success: &str,
    failure: &str,
) -> MacroResult {
    if status.map(|status| status.success()).unwrap_or(false) {
        MacroResult {
            ok: true,
            message: success.to_string(),
        }
    } else {
        MacroResult {
            ok: false,
            message: failure.to_string(),
        }
    }
}
