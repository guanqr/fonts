// Python script executor for font editing
import { spawn } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { BaseService } from '@/core/base/BaseService.js';
import type { PythonScriptConfig, EditResult } from '@/modules/edit/types.js';

export class PythonScriptRunner extends BaseService {
  private pythonExecutable: string;
  private readonly pythonCandidates: string[];
  private workingDirectory: string;
  private venvDir: string;
  private venvPython: string;
  private venvCreated: boolean = false;

  constructor(workingDirectory?: string, pythonExecutable?: string) {
    super('PythonScriptRunner');
    this.workingDirectory = workingDirectory ?? process.cwd();
    this.pythonCandidates = pythonExecutable
      ? [pythonExecutable]
      : this.getDefaultPythonCandidates();
    this.pythonExecutable = this.pythonCandidates[0];
    this.venvDir = path.join(this.workingDirectory, '.venv-scripts');
    this.venvPython =
      process.platform === 'win32'
        ? path.join(this.venvDir, 'Scripts', 'python.exe')
        : path.join(this.venvDir, 'bin', 'python');
  }

  private getDefaultPythonCandidates(): string[] {
    return process.platform === 'win32'
      ? ['python', 'py', 'python3']
      : ['python3', 'python'];
  }

  async checkPythonEnvironment(): Promise<boolean> {
    return this.executeWithErrorHandling(async () => {
      this.log('🔍 Checking Python environment...');

      let selectedPython: string | undefined;
      for (const candidate of this.pythonCandidates) {
        if (await this.checkCommand(candidate, ['--version'])) {
          selectedPython = candidate;
          break;
        }
      }

      if (!selectedPython) {
        this.log(
          `❌ Python not found. Tried: ${this.pythonCandidates.join(', ')}`,
          'error'
        );
        return false;
      }

      this.pythonExecutable = selectedPython;
      this.log(`✅ Using Python executable: ${this.pythonExecutable}`);

      // Create or validate the virtual environment
      await this.ensureVirtualEnvironment();

      this.log('✅ Python environment is ready');
      return true;
    }, 'check Python environment');
  }

  private async ensureVirtualEnvironment(): Promise<void> {
    if (await fs.pathExists(this.venvDir)) {
      const venvReady = await this.checkCommand(this.venvPython, ['--version']);
      if (venvReady) {
        this.log('📦 Virtual environment already exists');
        this.venvCreated = true;
        return;
      }

      this.log(
        '⚠️ Existing virtual environment is not usable; recreating',
        'warn'
      );
      this.venvCreated = false;
      await fs.remove(this.venvDir);
    }

    this.log('🔧 Creating virtual environment for script execution...');

    const venvCreated = await this.createVirtualEnvironment();
    if (!venvCreated) {
      throw new Error('Failed to create virtual environment');
    }

    this.venvCreated = true;
    this.log('✅ Virtual environment created successfully');
  }

  private async createVirtualEnvironment(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const venv = spawn(this.pythonExecutable, ['-m', 'venv', this.venvDir], {
        cwd: this.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';

      venv.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      venv.on('close', (code) => {
        if (code === 0) {
          this.log('✅ Virtual environment created');
          resolve(true);
        } else {
          this.log(
            `❌ Failed to create virtual environment (exit code: ${code})`,
            'error'
          );
          if (stderr) {
            this.log(`Error details: ${stderr.trim()}`, 'error');
          }
          resolve(false);
        }
      });

      venv.on('error', (error) => {
        this.log(
          `❌ Failed to create virtual environment: ${error.message}`,
          'error'
        );
        resolve(false);
      });
    });
  }

  private async checkCommand(
    command: string,
    args: string[]
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const process = spawn(command, args, {
        cwd: this.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.stderr?.on('data', (data) => {
        output += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          this.log(
            `✅ Command working: ${command} ${args.join(
              ' '
            )} -> ${output.trim()}`
          );
          resolve(true);
        } else {
          this.log(
            `❌ Command failed: ${command} ${args.join(
              ' '
            )} (exit code: ${code})`,
            'error'
          );
          resolve(false);
        }
      });

      process.on('error', (error) => {
        this.log(
          `❌ Command error: ${command} ${args.join(' ')} -> ${error.message}`,
          'error'
        );
        resolve(false);
      });
    });
  }

  async installRequiredPackages(packages: string[]): Promise<boolean> {
    if (packages.length === 0) return true;

    return this.executeWithErrorHandling(async () => {
      this.log(`📦 Checking required packages: ${packages.join(', ')}`);

      // First check which packages are already installed
      const missingPackages: string[] = [];

      for (const pkg of packages) {
        const isInstalled = await this.checkPackageInstalled(pkg);
        if (!isInstalled) {
          missingPackages.push(pkg);
        } else {
          this.log(`✅ Package already installed: ${pkg}`, 'debug');
        }
      }

      if (missingPackages.length === 0) {
        this.log('✅ All required packages are already installed');
        return true;
      }

      this.log(`📦 Installing missing packages: ${missingPackages.join(', ')}`);

      // Use virtual environment for package installation to avoid externally-managed-environment errors
      const success = await this.attemptPackageInstallation(
        missingPackages,
        []
      );

      return success;
    }, 'install required packages');
  }

  private async checkPackageInstalled(packageName: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const pythonExec = this.venvCreated
        ? this.venvPython
        : this.pythonExecutable;
      const check = spawn(pythonExec, ['-m', 'pip', 'show', packageName], {
        cwd: this.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      check.on('close', (code) => {
        resolve(code === 0);
      });

      check.on('error', () => {
        resolve(false);
      });
    });
  }

  async runScript(
    scriptConfig: PythonScriptConfig,
    fontId: string,
    fontPath: string
  ): Promise<EditResult> {
    return this.executeWithErrorHandling(async () => {
      const startTime = Date.now();

      this.log(`🐍 Running script ${scriptConfig.name} for font: ${fontId}`);

      // Check if script file exists
      const scriptPath = path.resolve(this.workingDirectory, scriptConfig.path);
      if (!(await fs.pathExists(scriptPath))) {
        throw new Error(`Script not found: ${scriptPath}`);
      }

      // Install required packages if specified
      if (
        scriptConfig.requiredPackages &&
        scriptConfig.requiredPackages.length > 0
      ) {
        const packagesInstalled = await this.installRequiredPackages(
          scriptConfig.requiredPackages
        );
        if (!packagesInstalled) {
          return {
            fontId,
            script: scriptConfig.name,
            status: 'error',
            message: 'Failed to install required packages',
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Execute the script directly with the font path as an argument
      const result = await this.executeScript(scriptPath, fontId, fontPath);

      return {
        ...result,
        executionTime: Date.now() - startTime,
      };
    }, `run script ${scriptConfig.name} for ${fontId}`);
  }

  private async executeScript(
    scriptPath: string,
    fontId: string,
    fontPath: string
  ): Promise<EditResult> {
    return new Promise((resolve) => {
      const pythonExec = this.venvCreated
        ? this.venvPython
        : this.pythonExecutable;
      // Pass the font path as a command line argument
      const python = spawn(pythonExec, [scriptPath, fontPath], {
        cwd: this.workingDirectory,
      });

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        if (code === 0) {
          this.log(`✅ Script completed successfully for ${fontId}`);
          resolve({
            fontId,
            script: path.basename(scriptPath),
            status: 'success',
            message: stdout.trim(),
          });
        } else {
          this.log(
            `❌ Script failed for ${fontId} (exit code: ${code})`,
            'error'
          );
          if (stderr) {
            this.log(`Error output: ${stderr}`, 'error');
          }
          resolve({
            fontId,
            script: path.basename(scriptPath),
            status: 'error',
            message: stderr.trim() || `Script exited with code ${code}`,
          });
        }
      });

      python.on('error', (error) => {
        this.log(
          `❌ Failed to execute script for ${fontId}: ${error.message}`,
          'error'
        );
        resolve({
          fontId,
          script: path.basename(scriptPath),
          status: 'error',
          message: error.message,
        });
      });
    });
  }

  private async attemptPackageInstallation(
    packages: string[],
    extraArgs: string[]
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const pythonExec = this.venvCreated
        ? this.venvPython
        : this.pythonExecutable;
      const pip = spawn(
        pythonExec,
        ['-m', 'pip', 'install', ...extraArgs, ...packages],
        {
          cwd: this.workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'], // Capture output for better error handling
        }
      );

      let stderr = '';

      pip.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      pip.on('close', (code) => {
        if (code === 0) {
          this.log(
            `✅ Packages installed successfully: ${packages.join(', ')}`
          );
          resolve(true);
        } else {
          this.log(
            `❌ Failed to install packages: ${packages.join(
              ', '
            )} (exit code: ${code})`,
            'error'
          );
          if (stderr) {
            this.log(`Error details: ${stderr.trim()}`, 'error');
          }
          resolve(false);
        }
      });

      pip.on('error', (error) => {
        this.log(`❌ Failed to install packages: ${error.message}`, 'error');
        resolve(false);
      });
    });
  }

  async cleanup(): Promise<void> {
    return this.executeWithErrorHandling(async () => {
      // Note: We don't automatically clean up the virtual environment
      // as it can be reused across multiple runs for efficiency
      // To clean it manually, delete the .venv-scripts directory
      this.log('🧹 Python script runner cleanup completed');
    }, 'cleanup Python script runner');
  }
}
