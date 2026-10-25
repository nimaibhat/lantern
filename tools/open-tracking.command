#!/bin/bash
# Opens the Tracking page in its own Chrome window that may speak without a click first. Demo laptops only:
# that window lets any site play sound on its own. Double-click to run; edit the two lines below first.

# The hub laptop's address (localhost on the hub itself), and this laptop's name as the Tracking page shows it.
# Use + for spaces, e.g. Living+room.
HUB=localhost
LAPTOP=Hallway

# A separate profile, so the setting applies even while normal Chrome is open
open -na "Google Chrome" --args --user-data-dir="$HOME/.lantern-chrome" --autoplay-policy=no-user-gesture-required --no-first-run "http://$HUB:3000/dashboard/tracking?laptop=$LAPTOP"
