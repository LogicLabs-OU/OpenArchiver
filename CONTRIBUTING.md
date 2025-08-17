# Contributing to Open Archiver

First off, thank you for considering contributing to Open Archiver! It's people like you that make open source such a great community. We welcome any and all contributions.

## Where do I start?

Not sure where to start? You can:

- Look through the [open issues](https://github.com/LogicLabs-OU/OpenArchiver/issues) for bugs or feature requests.
- Check the issues labeled `good first issue` for tasks that are a good entry point into the codebase.

## How to Contribute

### Reporting Bugs

If you find a bug, please ensure the bug was not already reported by searching on GitHub under [Issues](https://github.com/LogicLabs-OU/OpenArchiver/issues). If you're unable to find an open issue addressing the problem, open a new one. Be sure to include a **title and clear description**, as much relevant information as possible, and a **code sample** or an **executable test case** demonstrating the expected behavior that is not occurring.

### Suggesting Enhancements

If you have an idea for an enhancement, please open an issue to discuss it. This allows us to coordinate our efforts and prevent duplication of work.

### Pull Requests

1.  **Fork the repository** and create your branch from `main`.
2.  **Set up your development environment** by following the instructions in the `README.md`.
3.  **Make your changes.** Ensure your code follows the project's coding style.
4.  **Write tests** for any new functionality.
5.  **Ensure all tests pass** before submitting your pull request.
6.  **Update the documentation** if your changes require it.
7.  **Submit a pull request** to the `main` branch of the main repository. Please provide a clear description of the problem and solution. Include the relevant issue number if applicable.

## Contributor License Agreement

By submitting a pull request to this repository, you agree to the terms and conditions of our [Contributor License Agreement](./.github/CLA.md)

## Code of Conduct

This project and everyone participating in it is governed by the [Open Archiver Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior.

## Styleguides

### Git Commit Messages

- Use the present tense ("Add feature" not "Added feature").
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...").
- Limit the first line to 72 characters or less.
- Reference issues and pull requests liberally after the first line.

### TypeScript Styleguide

- Follow the existing code style.
- Use TypeScript's strict mode.
- Avoid using `any` as a type. Define clear interfaces and types in the `packages/types` directory.

### Formatting

We use Prettier for code formatting. Before you commit new code, it is necessary to check code format by running this command from the root folder:

`pnpm run lint`

If there are any format issues, you can use the following command to fix them

`pnpm run format`
