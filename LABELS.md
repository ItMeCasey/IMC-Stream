# Label files

Every label is a UTF-8 text file in `data/labels/<name>.txt`, rewritten live by `server/server.js`.
In OBS: **Add > Text (GDI+) > Read from file**, pick the file. Multi-line labels hold one entry per line, newest/top first.
"Session" labels reset when the stream goes online; "alltime" labels count since you installed the server.
`all_labels.json` holds every label in one file.

## Followers

| File | What it holds |
|---|---|
| `latest_follower.txt` | Newest follower |
| `recent_followers.txt` | Last 5 followers, newest first |
| `total_follower_count.txt` | Total followers (refreshed from Twitch) |
| `session_follower_count.txt` | New followers this stream |

## Subscribers & gifts

| File | What it holds |
|---|---|
| `latest_subscriber.txt` | Newest subscriber (new, resub or gift recipient) |
| `latest_resubscriber.txt` | Newest resub, with months |
| `latest_gift_subscriber.txt` | Newest gifter and how many subs they gave |
| `latest_gift_recipient.txt` | Newest person to receive a gift sub |
| `recent_subscribers.txt` | Last 5 subscribers, newest first |
| `total_subscriber_count.txt` | Total subscribers (refreshed from Twitch) |
| `total_subscriber_points.txt` | Sub points (what Twitch counts toward sub goals) |
| `session_subscriber_count.txt` | New + resub + gifted subs this stream |
| `session_new_sub_count.txt` | First-time (self-bought) subs this stream |
| `session_resub_count.txt` | Resubs this stream |
| `session_gift_sub_count.txt` | Gifted subs this stream |
| `session_top_gifter.txt` | Top gifter this stream |
| `session_top_gifters.txt` | Top 5 gifters this stream |
| `alltime_top_gifter.txt` | Top gifter since you installed the server |
| `alltime_gift_sub_count.txt` | Gift subs since you installed the server |
| `subathon_remaining.txt` | Time left on the subathon timer |
| `subathon_status.txt` | IDLE, RUNNING, PAUSED or DONE |

## Bits

| File | What it holds |
|---|---|
| `latest_cheer.txt` | Newest cheer |
| `recent_cheers.txt` | Last 5 cheers, newest first |
| `session_bits.txt` | Bits this stream |
| `session_cheer_count.txt` | Number of cheers this stream |
| `session_top_cheerer.txt` | Top cheerer this stream |
| `session_top_cheerers.txt` | Top 5 cheerers this stream |
| `alltime_bits.txt` | Bits since you installed the server |
| `alltime_top_cheerer.txt` | Top cheerer since you installed the server |
| `bits_leaderboard_day.txt` | Twitch bits leaderboard (day), top 5 |
| `top_cheerer_day.txt` | Twitch #1 cheerer (day) |
| `bits_leaderboard_week.txt` | Twitch bits leaderboard (week), top 5 |
| `top_cheerer_week.txt` | Twitch #1 cheerer (week) |
| `bits_leaderboard_month.txt` | Twitch bits leaderboard (month), top 5 |
| `top_cheerer_month.txt` | Twitch #1 cheerer (month) |
| `bits_leaderboard_year.txt` | Twitch bits leaderboard (year), top 5 |
| `top_cheerer_year.txt` | Twitch #1 cheerer (year) |
| `bits_leaderboard_all.txt` | Twitch bits leaderboard (all), top 5 |
| `top_cheerer_all.txt` | Twitch #1 cheerer (all) |

## Raids

| File | What it holds |
|---|---|
| `latest_raider.txt` | Newest raider (channel - viewers) |
| `latest_raid_viewers.txt` | Viewer count of the newest raid |
| `recent_raiders.txt` | Last 5 raids, newest first |
| `session_raid_count.txt` | Raids this stream |
| `session_raider_viewers.txt` | Raiding viewers this stream |
| `alltime_biggest_raid.txt` | Biggest raid since you installed the server |

## Channel points

| File | What it holds |
|---|---|
| `latest_redemption.txt` | Newest redemption (user - reward) |
| `latest_redemption_user.txt` | Who redeemed last |
| `latest_redemption_reward.txt` | What was redeemed last |
| `recent_redemptions.txt` | Last 5 redemptions, newest first |
| `session_redemption_count.txt` | Redemptions this stream |
| `session_channel_points_spent.txt` | Channel points spent this stream |
| `latest_shop_redemption.txt` | Latest shop redemption (viewer - item) |

## Tips

| File | What it holds |
|---|---|
| `latest_tip.txt` | Newest tip (from your webhook) |
| `session_tip_total.txt` | Tips this stream |
| `session_top_tipper.txt` | Top tipper this stream |

## Hype train

| File | What it holds |
|---|---|
| `hype_train_status.txt` | ACTIVE while a hype train is running |
| `hype_train_level.txt` | Current hype train level |
| `hype_train_progress.txt` | Progress toward the next level |
| `hype_train_total.txt` | Total points in the current train |
| `hype_train_top_contributor.txt` | Top contributor of the current/last train |
| `hype_train_last_level.txt` | Level the last train reached |

## Creator goal

| File | What it holds |
|---|---|
| `goal_description.txt` | Creator goal description |
| `goal_current.txt` | Creator goal current amount |
| `goal_target.txt` | Creator goal target |
| `goal_progress.txt` | Creator goal "current / target" |
| `goal_percent.txt` | Creator goal percent |

## Polls

| File | What it holds |
|---|---|
| `poll_status.txt` | ACTIVE / COMPLETED / ARCHIVED / TERMINATED |
| `poll_title.txt` | Poll question |
| `poll_choices.txt` | Poll choices with votes |
| `poll_total_votes.txt` | Total poll votes |
| `poll_leader.txt` | Poll leader |

## Predictions

| File | What it holds |
|---|---|
| `prediction_status.txt` | OPEN / LOCKED / RESOLVED / CANCELED |
| `prediction_title.txt` | Prediction question |
| `prediction_outcomes.txt` | Prediction outcomes |
| `prediction_winner.txt` | Winning outcome |

## Stream info

| File | What it holds |
|---|---|
| `stream_status.txt` | LIVE or OFFLINE |
| `stream_title.txt` | Current stream title |
| `stream_game.txt` | Current category/game |
| `stream_viewers.txt` | Current viewer count |
| `session_peak_viewers.txt` | Peak viewers this stream |
| `stream_uptime.txt` | Time live, H:MM:SS |
| `stream_started_at.txt` | Time the stream started (local clock) |
| `channel_name.txt` | Your channel display name |

## Chat

| File | What it holds |
|---|---|
| `latest_chatter.txt` | Last person to chat |
| `latest_chat_message.txt` | Last chat message ("name: text") |
| `recent_chat.txt` | Last 5 chat messages |
| `session_chat_messages.txt` | Chat messages this stream |
| `session_unique_chatters.txt` | Unique chatters this stream |
| `session_top_chatter.txt` | Most active chatter this stream |
| `session_top_chatters.txt` | Top 5 chatters this stream |

## Ads

| File | What it holds |
|---|---|
| `ad_status.txt` | Ad break status |
| `next_ad_in.txt` | Countdown to the next ad (M:SS) |
| `next_ad_time.txt` | Clock time of the next ad |
| `last_ad_duration.txt` | Length of the last ad (seconds) |
| `ad_snoozes_left.txt` | Ad snoozes remaining |

## Charity

| File | What it holds |
|---|---|
| `latest_charity_donor.txt` | Newest charity donation |
| `charity_name.txt` | Active charity campaign |
| `charity_progress.txt` | Charity "raised / goal" |

## Other

| File | What it holds |
|---|---|
| `currency_name.txt` | Name of your chat currency |
| `currency_top.txt` | Top 5 viewers by currency |
| `currency_richest_viewer.txt` | Viewer with the most currency |
| `currency_in_circulation.txt` | Total currency held by all viewers |
| `now_playing.txt` | Current song as "Artist - Title" |
| `now_playing_title.txt` | Current song title |
| `now_playing_artist.txt` | Current song artist |
| `now_playing_album.txt` | Current song album |
| `now_playing_status.txt` | PLAYING or PAUSED (blank when nothing is playing) |
| `now_playing_progress.txt` | Song progress, e.g. 1:23 / 3:45 |
| `now_playing_link.txt` | Spotify link to the current song |
| `countdown_remaining.txt` | Time left on the countdown / subathon timer |
| `countdown_status.txt` | IDLE, RUNNING, PAUSED or DONE |
