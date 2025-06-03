import fs from "fs";
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import * as path from "path";
import * as vscode from "vscode";

export default class ProjectParser {
  static Parse(
    projectPath: string,
    packageVersions: Map<string, string>
  ): Project {
    let projectContent = fs.readFileSync(projectPath, "utf8");
    let document = new DOMParser().parseFromString(projectContent);
    if (document == undefined) throw `${projectPath} has invalid content`;

    let packagesReferences = xpath.select(
      "//ItemGroup/PackageReference",
      document
    ) as Node[];
    let project: Project = {
      Path: projectPath,
      Name: path.basename(projectPath),
      Packages: Array(),
    };

    (packagesReferences || []).forEach((p: any) => {
      let version = p.attributes?.getNamedItem("Version");
      if (version) {
        version = version.value;
      } else {
        version = xpath.select("string(Version)", p);
        if (!version) {
          version = null;
        }
      }

      let projectPackage: ProjectPackage = {
        Id: p.attributes?.getNamedItem("Include").value,
        Version: version,
      };
      this.UpdatePackageVersion(projectPackage, packageVersions);
      project.Packages.push(projectPackage);
    });

    return project;
  }
  static ParseProp(projectPath: string): Props[] {
    let projectContent = fs.readFileSync(projectPath, "utf8");
    let document = new DOMParser().parseFromString(projectContent);
    if (document == undefined) throw `${projectPath} has invalid content`;

    let packagesReferences = xpath.select(
      "//ItemGroup/PackageReference | //ItemGroup/PackageVersion",
      document
    ) as Node[];
    var props: Props[] = [];
    (packagesReferences || []).forEach((p: any) => {
      var type = p.nodeName == "PackageReference" ? 1 : 2;
      let version = p.attributes?.getNamedItem("Version");
      if (version) {
        version = version.value;
      } else {
        version = xpath.select("string(Version)", p);
        if (!version) {
          version = null;
        }
      }
      let projectPackage: ProjectPackage = {
        Id: p.attributes?.getNamedItem("Include").value,
        Version: version,
      };
      props.push({
        Type: type,
        Package: projectPackage,
      });
    });

    return props;
  }

  static UpdatePackageVersion(
    projectPackage: ProjectPackage,
    packageVersions: Map<string, string>
  ) {
    if (!projectPackage.Version) {
      projectPackage.Version = packageVersions.get(projectPackage.Id) || "";
    }
  }

  static async GetProjectsAsync(
    projectFiles: Array<string>
  ): Promise<Array<Project>> {
    let propsFiles = await vscode.workspace.findFiles("**/Directory.*.props");
    var props: Props[] = [];
    propsFiles
      .map((x) => x.fsPath)
      .forEach((x) => {
        try {
          props.push(...this.ParseProp(x));
        } catch (e) {
          console.error(e);
        }
      });
    var packageVersions: Map<string, string> = new Map();
    props
      .filter((p) => p.Type === 2)
      .forEach((item) => {
        packageVersions.set(item.Package.Id, item.Package.Version);
      });
    var allPackages = props.filter((p) => p.Type === 1).map((p) => p.Package);
    allPackages.forEach((item) => {
      this.UpdatePackageVersion(item, packageVersions);
    });
    let projects: Array<Project> = Array();
    projectFiles.forEach((x) => {
      try {
        let project = this.Parse(x, packageVersions);
        project.Packages.push(...allPackages);
        projects.push(project);
      } catch (e) {
        console.error(e);
      }
    });
    let compareName = (nameA: string, nameB: string) => {
      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    };
    return projects.sort((a, b) =>
      compareName(a.Name?.toLowerCase(), b.Name?.toLowerCase())
    );
  }
}
