//! What a launch of Vega asks the running Vega to do.
//!
//! A second launch does not start a second Vega. `tauri-plugin-single-instance` hands its
//! command line to the one already running (on Linux over D-Bus, under the name
//! `com.veganostr.Vega.SingleInstance`) and exits once that one has taken it. That is how
//! something outside Vega, such as a bar button, a keybinding or a script, asks it for
//! something: `vega --compose` opens the compose box, and a plain `vega` brings the window
//! forward. Before this a second launch started a whole second Vega, with a second database
//! connection and a second embedded relay that could not bind its port.
//!
//! The first launch's own command line is read the same way, so `vega --compose` works whether
//! or not Vega was running.
//!
//! Commands wait in a queue until the frontend takes them (`take_launch_commands`), and the
//! frontend is told when one arrives (the `launch-command` event). An event sent before the
//! webview listens is lost; a queue is not.

use serde::Serialize;
use std::sync::Mutex;

/// One thing a command line asked for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchCommand {
    /// Open the compose box.
    Compose,
}

/// The commands on a command line. The first argument is the program and is skipped, and
/// anything not known is ignored: a launcher that adds arguments of its own changes nothing.
pub fn parse(args: &[String]) -> Vec<LaunchCommand> {
    args.iter()
        .skip(1)
        .filter_map(|arg| match arg.as_str() {
            "--compose" => Some(LaunchCommand::Compose),
            _ => None,
        })
        .collect()
}

/// This process's own command line, without failing on an argument that is not UTF-8
/// (`std::env::args` panics on one).
pub fn own_args() -> Vec<String> {
    std::env::args_os()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

/// The commands not yet taken by the frontend.
#[derive(Default)]
pub struct PendingLaunch(Mutex<Vec<LaunchCommand>>);

impl PendingLaunch {
    pub fn push(&self, commands: Vec<LaunchCommand>) {
        if let Ok(mut queue) = self.0.lock() {
            queue.extend(commands);
        }
    }

    pub fn take(&self) -> Vec<LaunchCommand> {
        self.0
            .lock()
            .map(|mut queue| std::mem::take(&mut *queue))
            .unwrap_or_default()
    }
}

/// Whether this build hands a second launch to the running Vega. A release build always does.
/// A debug build does only with `VEGA_SINGLE_INSTANCE` set: otherwise `npm run tauri dev` next
/// to an installed Vega that is running would hand itself to the installed one and exit, which
/// looks exactly like the dev build failing to start.
pub fn single_instance_enabled() -> bool {
    !cfg!(debug_assertions) || std::env::var_os("VEGA_SINGLE_INSTANCE").is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn reads_compose_and_skips_the_program() {
        assert_eq!(parse(&args(&["/usr/bin/vega", "--compose"])), vec![LaunchCommand::Compose]);
        // The program's own name is never a command, whatever it is called.
        assert_eq!(parse(&args(&["--compose"])), vec![]);
    }

    #[test]
    fn a_plain_launch_asks_for_nothing() {
        assert_eq!(parse(&args(&["vega"])), vec![]);
        assert_eq!(parse(&[]), vec![]);
    }

    #[test]
    fn ignores_what_it_does_not_know() {
        assert_eq!(
            parse(&args(&["vega", "--gapplication-service", "--compose", "%U", "compose"])),
            vec![LaunchCommand::Compose]
        );
    }

    #[test]
    fn the_queue_hands_each_command_out_once() {
        let pending = PendingLaunch::default();
        pending.push(vec![LaunchCommand::Compose]);
        pending.push(vec![LaunchCommand::Compose]);
        assert_eq!(pending.take(), vec![LaunchCommand::Compose, LaunchCommand::Compose]);
        assert_eq!(pending.take(), vec![]);
    }

    #[test]
    fn the_frontend_reads_the_command_as_a_plain_word() {
        assert_eq!(serde_json::to_string(&LaunchCommand::Compose).unwrap(), "\"compose\"");
    }
}
