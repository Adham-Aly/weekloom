cask "weekloom" do
  arch arm: "-arm64", intel: ""

  version "0.1.1"
  sha256 arm:   "1ec87d35d6e2cae47d12a2df8f62e08c68ad5fde3bc84dd4bfdfc9247a4c1b58",
         intel: "2d6ed135718adfd7f73c9c6dd2c0c0e1085ff8f95ccba66f3de6c802faad71d0"

  url "https://github.com/MoizDev/weekloom/releases/download/v#{version}/Weekloom-#{version}#{arch}.dmg",
      verified: "github.com/MoizDev/weekloom/"
  name "Weekloom"
  desc "Local-first Gantt-chart planner that makes no network requests"
  homepage "https://github.com/MoizDev/weekloom"

  depends_on macos: :big_sur

  app "Weekloom.app"

  # ⚠️ `~/.weekloom` is deliberately NOT listed here. It is the user's entire
  # plan — the one SQLite file this application exists to keep — and an
  # uninstall must not take it. Someone reinstalling gets their boards back.
  zap trash: [
    "~/Library/Application Support/weekloom",
    "~/Library/Preferences/com.weekloom.desktop.plist",
    "~/Library/Saved Application State/com.weekloom.desktop.savedState",
  ]

  # ⚠️ Homebrew no longer has a `--no-quarantine` flag and offers no way for a
  # cask to waive quarantine, so this cannot be automated away — the person
  # installing has to clear the attribute themselves, and will conclude the
  # download is corrupt if nobody tells them that.
  caveats <<~EOS
    Weekloom is ad-hoc signed rather than signed with a paid Apple Developer
    ID, so macOS has flagged it as quarantined and Gatekeeper will refuse to
    open it, reporting that it is "damaged". It is not damaged. Clear the flag:

      xattr -dr com.apple.quarantine "/Applications/Weekloom.app"

    Then open it normally. This is needed once, not on every launch.
  EOS
end
