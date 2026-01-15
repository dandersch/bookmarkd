#!/bin/bash

# for firefox:
web-ext run --firefox-profile ./.web-ext-profile --keep-profile-changes --ignore-files=.web-ext-profile

# for chromium:
#web-ext run -t chromium --ignore-files=.web-ext-profile/*
