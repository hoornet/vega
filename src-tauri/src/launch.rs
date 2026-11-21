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
//! `--hidden` is not a command: it says how the first launch starts, in the tray with no window.
//! The login entry that "Start Vega when I log in" writes starts Vega that way. Handed to a Vega
//! that is already running, it does nothing at all: the login entry ran while Vega was open.
//!
//! A `nostr:` link (NIP-21) is a command too: clicking one in a browser or another app starts
//! `vega nostr:nevent1…` on Linux and Windows, which this reads like `--compose` (on macOS the link
//! arrives as an Apple Event instead, through the deep-link plugin, into the same queue). Anyone
//! can make a link, a web page included, so only its shape is accepted here, and the frontend
//! only opens what it names: a profile, a note or an article, never anything that publishes.
//!
//! Commands wait in a queue until the frontend takes them (`take_launch_commands`), and the
//! frontend is told when one arrives (the `launch-command` event). An event sent before the
//! webview listens is lost; a queue is not.

use serde::Serialize;
use std::sync::Mutex;

/// One thing a command line asked for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchCommand {
    /// Open the compose box.
    Compose,
    /// Open what a `nostr:` link names, as `link` returns it.
    Open(String),
}

/// The NIP-19 references a link may open: a profile, a note, an article. Anything else, an
/// `nsec` above all, is not a link Vega opens, and is dropped without being kept or echoed.
const OPENABLE: [&str; 5] = ["npub1", "nprofile1", "note1", "nevent1", "naddr1"];

/// The bech32 alphabet, which is all a reference holds after its prefix.
const BECH32: &str = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/// The longest reference a link may hold. An `nevent` or `naddr` with relay hints runs to a few
/// hundred characters; this leaves room for that, not for a command line built to be large.
const MAX_REFERENCE: usize = 2000;

/// A `nostr:` link as Vega will open it, `nostr:` and the reference in lower case, or `None`
/// for anything else. Only the shape is checked here; the frontend decodes the reference.
/// `nostr://…`, which some apps write, is read as `nostr:…`.
pub fn link(arg: &str) -> Option<String> {
    if !arg.get(..6)?.eq_ignore_ascii_case("nostr:") {
        return None;
    }
    let reference = arg[6..].trim_start_matches('/').to_ascii_lowercase();
    if reference.len() > MAX_REFERENCE {
        return None;
    }
    let prefix = OPENABLE.iter().find(|p| reference.starts_with(**p))?;
    let data = &reference[prefix.len()..];
    if data.is_empty() || !data.chars().all(|c| BECH32.contains(c)) {
        return None;
    }
    Some(format!("nostr:{reference}"))
}

/// The commands on a command line. The first argument is the program and is skipped, and
/// anything not known is ignored: a launcher that adds arguments of its own changes nothing.
/// One link at most: a click hands over one, and a line holding many is not a click.
pub fn parse(args: &[String]) -> Vec<LaunchCommand> {
    let mut commands = Vec::new();
    let mut linked = false;
    for arg in args.iter().skip(1) {
        if arg == "--compose" {
            commands.push(LaunchCommand::Compose);
        } else if !linked {
            if let Some(link) = link(arg) {
                commands.push(LaunchCommand::Open(link));
                linked = true;
            }
        }
    }
    commands
}

/// Whether a command line asks Vega to start without a window (`--hidden`). As with `parse`,
/// the first argument is the program and is not read.
pub fn starts_hidden(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| arg == "--hidden")
}

/// Whether a second launch should bring the window forward: always, unless all it says is
/// `--hidden`. A command on the same line still wins, since a command is for the window.
pub fn brings_forward(args: &[String]) -> bool {
    !starts_hidden(args) || !parse(args).is_empty()
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
    fn hidden_is_read_after_the_program_and_is_not_a_command() {
        assert!(starts_hidden(&args(&["/usr/bin/vega", "--hidden"])));
        assert!(!starts_hidden(&args(&["--hidden"])));
        assert!(!starts_hidden(&args(&["vega", "--compose"])));
        assert_eq!(parse(&args(&["vega", "--hidden"])), vec![]);
    }

    #[test]
    fn a_second_launch_that_only_says_hidden_leaves_the_window_alone() {
        assert!(!brings_forward(&args(&["vega", "--hidden"])));
        assert!(brings_forward(&args(&["vega"])));
        assert!(brings_forward(&args(&["vega", "--compose"])));
        // A command is for the window, whatever else is on the line.
        assert!(brings_forward(&args(&["vega", "--hidden", "--compose"])));
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

    /// The example public key of NIP-19 itself.
    const NPUB: &str = "npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg";

    fn open(reference: &str) -> Vec<LaunchCommand> {
        vec![LaunchCommand::Open(format!("nostr:{reference}"))]
    }

    #[test]
    fn reads_a_nostr_link_as_a_command() {
        assert_eq!(parse(&args(&["vega", &format!("nostr:{NPUB}")])), open(NPUB));
        for prefix in ["nprofile1", "note1", "nevent1", "naddr1"] {
            let reference = format!("{prefix}qqsx3xd");
            assert_eq!(parse(&args(&["vega", &format!("nostr:{reference}")])), open(&reference));
        }
        // A link is a command for the window.
        assert!(brings_forward(&args(&["vega", "--hidden", &format!("nostr:{NPUB}")])));
    }

    #[test]
    fn a_link_is_read_in_lower_case_and_nostr_slash_slash_is_nostr() {
        let upper = format!("NOSTR:{}", NPUB.to_uppercase());
        assert_eq!(parse(&args(&["vega", &upper])), open(NPUB));
        assert_eq!(parse(&args(&["vega", &format!("nostr://{NPUB}")])), open(NPUB));
    }

    #[test]
    fn a_secret_key_or_anything_else_is_not_a_link() {
        for arg in [
            "nostr:nsec1qqsx3xdqqsx3xd",
            "nostr:ncryptsec1qqsx3xd",
            "nostr:nrelay1qqsx3xd",
            "nostr:",
            "nostr:npub1",
            "nostr:npub1abc$def",
            "nostr:npub1abcbio",
            "https://njump.me/npub1abc",
            NPUB,
            "nost",
        ] {
            assert_eq!(parse(&args(&["vega", arg])), vec![], "{arg}");
        }
        let long = format!("nostr:nevent1{}", "q".repeat(MAX_REFERENCE));
        assert_eq!(parse(&args(&["vega", &long])), vec![]);
    }

    #[test]
    fn one_link_per_command_line() {
        let note = "note1qqsx3xd";
        assert_eq!(
            parse(&args(&["vega", &format!("nostr:{NPUB}"), "--compose", &format!("nostr:{note}")])),
            vec![LaunchCommand::Open(format!("nostr:{NPUB}")), LaunchCommand::Compose]
        );
    }

    #[test]
    fn the_frontend_reads_a_link_as_open() {
        let command = LaunchCommand::Open(format!("nostr:{NPUB}"));
        assert_eq!(
            serde_json::to_string(&command).unwrap(),
            format!("{{\"open\":\"nostr:{NPUB}\"}}")
        );
    }
}
