#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { GrokDB } from './index.js';

const program = new Command();

program
  .name('grokdb')
  .description('GrokDB CLI tool for database management')
  .version('1.0.0');

program
  .command('create-migration <name>')
  .description('Create a new migration file')
  .action(async (name) => {
    const db = new GrokDB('database.sqlite');
    const path = await db.createMigration(name);
    console.log(chalk.green(`Created migration: ${path}`));
    db.close();
  });

program
  .command('migrate')
  .description('Run pending migrations')
  .option('-d, --down', 'Rollback migrations')
  .action(async (options) => {
    const db = new GrokDB('database.sqlite');
    await db.migrate(options.down ? 'down' : 'up');
    console.log(chalk.green('Migrations completed successfully'));
    db.close();
  });

program
  .command('cli')
  .description('Start interactive CLI')
  .action(async () => {
    const db = new GrokDB('database.sqlite');
    
    console.log(chalk.blue('Welcome to GrokDB CLI'));
    
    while (true) {
      const { command } = await inquirer.prompt([{
        type: 'input',
        name: 'command',
        message: 'Enter SQL command (or "exit" to quit):',
      }]);

      if (command.toLowerCase() === 'exit') break;

      try {
        const result = db.query(command, []);
        console.table(result);
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
      }
    }

    db.close();
  });

program.parse();
