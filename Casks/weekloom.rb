cask "weekloom" do
  arch arm: "-arm64", intel: ""

  version "0.1.0"
  sha256 arm:   "4c5d9a07d2f2e0a349c87e9602aeb010010f20fe0f6255e09abca37c1d4632f7",
         intel: "afc1b7b9bd644094c4405c0950cddb2fa856642f8ea50ddc93f5f303a4492ad9"

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
