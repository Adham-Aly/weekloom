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

  caveats <<~EOS
    Weekloom is not signed with an Apple Developer ID, so macOS quarantines it
    and Gatekeeper reports it as "damaged". Install with:

      brew install --cask --no-quarantine weekloom

    If you already installed it without that flag:

      xattr -dr com.apple.quarantine "/Applications/Weekloom.app"
  EOS
end
