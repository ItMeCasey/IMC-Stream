# Code signing policy (draft, to publish once SignPath approves the project)

Windows installers of IMC-Stream are signed with a certificate issued to the SignPath Foundation, using SignPath.io. This text is the draft of the policy SignPath asks each project to publish on its home page.

> Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## What gets signed
Only the installer (`IMC-Stream Setup <version>.exe`) built by the `release` GitHub Actions workflow from the tagged source in this repository. Nothing is signed from a developer's PC.

## Roles
- **Authors, reviewers and approvers:** the repository owner ([@ItMeCasey](https://github.com/ItMeCasey)). Every signing request is approved by the owner after checking the build.

## Privacy
This program does not send any information to third parties on its own except as described in the README ("Privacy and your data"). Signing does not add any telemetry.
