#!/bin/bash
# Generates samples/sample.wav — a ~2 minute two-voice sales-call conversation
# used to test transcription and the full acceptance flow.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf _parts && mkdir _parts

V1="Daniel"              # Mike, the customer (UK voice)
V2="Samantha"            # Sarah, the vendor rep (US voice)
i=0
line() { # $1 voice, $2 text
  i=$((i+1))
  say -v "$1" -o "_parts/$(printf '%02d' $i).aiff" "$2"
}

line "$V2" "Hi Mike, thanks for making time today. I wanted to walk through the pilot results and talk about next steps for the rollout."
line "$V1" "Sounds good Sarah. Before we start, I should mention our budget review is happening at the end of the month, so pricing is top of mind for us."
line "$V2" "Understood. So first, the pilot. Your team processed about twelve thousand documents through the system last quarter, and the error rate dropped from four percent to under one percent."
line "$V1" "Yes, the quality team was very happy with that. The main complaint was the onboarding. It took our reviewers almost three weeks to get comfortable with the interface."
line "$V2" "That's fair feedback. We're shipping a new guided onboarding flow in September that should cut that to under a week."
line "$V1" "Good to hear. Now, on pricing. What would the full rollout look like for us?"
line "$V2" "For your volume, the enterprise plan comes to four thousand two hundred dollars per month, billed annually. That includes unlimited seats and the premium support tier."
line "$V1" "Four thousand two hundred. Okay. That's above what we had penciled in. We were expecting something closer to three thousand five hundred."
line "$V2" "There's some flexibility if you commit to a two year term. I could bring it down to three thousand eight hundred per month with the two year agreement."
line "$V1" "That could work. I'd need to run it past our chief financial officer, Janet, before I can commit to anything."
line "$V2" "Of course. One other thing to flag. The compliance module you asked about, audit trails and electronic signatures, that ships in October and it's included in the enterprise plan at no extra cost."
line "$V1" "That's important for us. Our auditors specifically asked for electronic signature support last cycle."
line "$V2" "Great. So for next steps, I'll send over the revised proposal with the two year pricing by Friday. Can you get me the list of departments for the rollout plan?"
line "$V1" "Yes, I'll get you the department list by next Wednesday. And let's schedule the technical review with our IT security team for the week after."
line "$V2" "Perfect, I'll set that up. And I'll also loop in our implementation lead, Marcus, so he can start on the migration plan."
line "$V1" "Sounds like a plan. Let's decide on the contract term once Janet has seen the numbers. Thanks Sarah, this was helpful."
line "$V2" "Thank you Mike. I'll follow up with the proposal by Friday. Have a great rest of your week."

# concatenate, add small gaps, output 16 kHz mono wav
inputs=()
filter=""
n=0
for f in _parts/*.aiff; do
  inputs+=(-i "$f")
  filter+="[$n:a]"
  n=$((n+1))
done
ffmpeg -y "${inputs[@]}" -filter_complex "${filter}concat=n=${n}:v=0:a=1[cat];[cat]aresample=16000,pan=mono|c0=c0[out]" -map "[out]" -c:a pcm_s16le sample.wav 2>/dev/null
rm -rf _parts
afinfo sample.wav | grep -E 'duration|data format'
