# Generates the test recordings in tools\wav using Windows' built-in speech voices.
# The recordings are not kept in the repository. Run from the project root:
#
#     powershell -ExecutionPolicy Bypass -File tools\make_wavs.ps1
#
# File names are <case>.<voice>.wav. test.js and sim.js use the long voice tag
# (microsoftdaviddesktop); probe.js is pointed at files by prefix (var_, c_).

Add-Type -AssemblyName System.Speech
$out = Join-Path $PSScriptRoot 'wav'
New-Item -ItemType Directory -Force $out | Out-Null

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# Cases for the "skippy" profile (test.html, sim.html). Long voice tag.
$plain = [ordered]@{
    skippy              = 'Skippy'
    continue_skippy     = 'Continue Skippy'
    hey_skippy_sentence = 'I was thinking, Skippy'
    neg_weather         = 'What is the weather going to be like tomorrow morning'
    neg_similar         = 'I am happy to skip the meeting and keep the kitty'
    neg_continue        = 'Please continue with the story'
    neg_trippy          = 'Trippy'
    neg_trippy_sentence = 'That movie was really trippy'
    neg_rhymes          = 'Tippy. Drippy. Slippy. Chippy. Snippy.'
}

# Variations of the continue phrase, and cases for the "computer" profile (probe.html).
# Short voice tag. Values are SSML fragments.
$ssml = [ordered]@{
    var_xslow     = '<prosody rate="x-slow">continue skippy</prosody>'
    var_slow      = '<prosody rate="slow">continue skippy</prosody>'
    var_fast      = '<prosody rate="fast">continue skippy</prosody>'
    var_xfast     = '<prosody rate="x-fast">continue skippy</prosody>'
    var_pause     = 'continue <break time="400ms"/> skippy'
    var_longpause = 'continue <break time="900ms"/> skippy'
    var_low       = '<prosody pitch="low" rate="fast">continue skippy</prosody>'
    var_high      = '<prosody pitch="high">continue skippy</prosody>'
    var_soft      = '<prosody volume="x-soft">continue skippy</prosody>'
    var_bippy     = 'continue bippy'
    c_computer          = 'Computer'
    c_continue_computer = 'Continue computer'
    c_fast              = '<prosody rate="fast">continue computer</prosody>'
    c_sentence          = 'Hey, computer'
    c_neg_commuter      = 'The commuter train was late'
    c_neg_compute       = 'We need to compute the total and compare it'
    c_neg_weather       = 'What is the weather going to be like tomorrow morning'
    c_neg_continue      = 'Please continue with the story'
}

$count = 0
foreach ($voice in $synth.GetInstalledVoices()) {
    $name = $voice.VoiceInfo.Name
    $synth.SelectVoice($name)

    $longTag = ($name -replace '\W', '').ToLower()
    foreach ($case in $plain.Keys) {
        $synth.SetOutputToWaveFile((Join-Path $out "$case.$longTag.wav"), $format)
        $synth.Speak($plain[$case])
        $count++
    }

    $shortTag = ($name -replace 'Microsoft | Desktop', '').ToLower()
    foreach ($case in $ssml.Keys) {
        $synth.SetOutputToWaveFile((Join-Path $out "$case.$shortTag.wav"), $format)
        $synth.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">' + $ssml[$case] + '</speak>')
        $count++
    }
}
$synth.SetOutputToNull()
$synth.Dispose()
"wrote $count recordings to $out"
