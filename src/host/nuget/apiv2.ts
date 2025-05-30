import axios, { AxiosError, AxiosInstance, AxiosProxyConfig, AxiosRequestConfig, AxiosResponse } from "axios";
import _ from "lodash";
const execSync = require("child_process").execSync;
import * as vscode from "vscode";
import TaskExecutor from "../utilities/task-executor";
import os from "os";
import { XMLParser } from "fast-xml-parser";

type GetPackagesResponse = {
  data: Array<Package>;
};

type GetPackageResponse = {
  isError: boolean;
  errorMessage: string | undefined;
  data: Package | undefined;
};

type GetPackageDetailsResponse = {
  data: PackageDetails;
};
const SemVerLevel: string = "semVerLevel=2.0.0";
// constants for /Packages(ID,VERSION) endpoint
const FindPackagesById: string = "/FindPackagesById()?id='{0}'&semVerLevel=2.0.0";

// constants for /Search() endpoint
const SearchEndpointFormat: string = "/Search()?$filter=IsAbsoluteLatestVersion&searchTerm='{0}'&includePrerelease={1}&$skip={2}&$top={3}&" + SemVerLevel;
export default class NuGetApiV2 {

  private _packageInfoUrl: string = "";
  private _token: string | null = null;
  private http: AxiosInstance;

  constructor(private readonly _url: string, private readonly _credentialProviderFolder: string) {
    this.http = axios.create({
      proxy: this.getProxy(),
    });

    this.http.interceptors.request.use((x) => {
      if (this._token != null) x.headers["Authorization"] = `Basic ${this._token}`;
      return x;
    });

    this.http.interceptors.response.use(null, async (x) => {
      if (x.response?.status != 401) return x;
      let credentials = await this.GetCredentials();
      this._token = btoa(`${credentials.Username}:${credentials.Password}`);
      return this.http(x.config);
    });
  }
  formatString(format: string, ...args: any) {
    return format.replace(/{(\d+)}/g, (match, number) =>
      typeof args[number] !== "undefined" ? args[number] : match
    );
  }
  getPackages(xml: string): Array<Package> {
    const parser = new XMLParser({
      ignoreAttributes: false
    });
    const jsonObject = parser.parse(xml);
    var entry = jsonObject?.feed?.entry || [];
    var datas: any = [];
    if (Array.isArray(entry)) {
      datas = entry;
    } else {
      datas = [entry];
    }
    return datas.map((item: any) => {
      var properties = item["m:properties"];
      var id = item.id || "";
      if (item.link.length > 0) {
        id = this._url + "/" + item.link[0]["@_href"];
      }
      return ({
        Id: id,
        Name: item.title["#text"] || "",
        Authors: [item.author.name],
        Description: properties["d:Description"] || "",
        IconUrl: properties["d:IconUrl"] || "",
        Registration: item.registration || "",
        LicenseUrl: properties["d:LicenseUrl"] || "",
        ProjectUrl: properties["d:ProjectUrl"] || "",
        TotalDownloads: properties["d:DownloadCount"]["#text"] || 0,
        Verified: item.verified || false,
        Version: properties["d:Version"] || "",
        Versions: [],
        Tags: properties['d:Tags'] || [],
      });
    });
  }
  async GetPackagesAsync(
    filter: string,
    prerelease: boolean,
    skip: number,
    take: number
  ): Promise<GetPackagesResponse> {
    let uri = this._url + this.formatString(
      SearchEndpointFormat,
      encodeURIComponent(filter),
      prerelease,
      skip,
      take);
    let result = await this.ExecuteGet(uri);
    var mappedData = this.getPackages(result.data);
    var tasks: Array<Promise<any>> = [];
    for (const data of mappedData) {
      tasks.push(this.GetPackageAsync(data.Name)
        .then(p => {
          if (!p.isError) {
            data.Versions = p.data?.Versions || [];
          }
        }));
    }
    await Promise.all(tasks);
    return {
      data: mappedData,
    };
  }

  async GetVersionsAsync(id: string): Promise<Array<string>> {
    let uri = this._url + this.formatString(
      FindPackagesById,
      encodeURIComponent(id));
    let result = await this.ExecuteGet(uri);
    const parser = new XMLParser();
    const jsonObject = parser.parse(result.data);
    var versions: Array<string> = jsonObject.feed.entry
      .map((item: any) => {
        var properties = item["m:properties"];
        var version = properties["d:Version"];
        if (version) {
          return version;
        }
      });
    return versions.filter(p => !p);
  }
  async GetPackageAsync(id: string): Promise<GetPackageResponse> {
    let uri = this._url + this.formatString(
      FindPackagesById,
      encodeURIComponent(id));
    try {
      let result = await this.ExecuteGet(uri);
      var mappedData = this.getPackages(result.data);
      let data = mappedData[0];
      data.Versions = mappedData.map(p => ({
        Version: p.Version,
        Id: p.Id,
      })).reverse();
      return { data: data, isError: false, errorMessage: undefined };
    } catch (error) {
      return { data: undefined, isError: true, errorMessage: "" };
    }
  }

  async GetPackageDetailsAsync(packageVersionUrl: string): Promise<GetPackageDetailsResponse> {
    let packageDetails: PackageDetails = {
      dependencies: {
        frameworks: {},
      },
    };
    try {
      let result = await this.ExecuteGet(packageVersionUrl);
      const parser = new XMLParser();
      const jsonObject = parser.parse(result.data);
      var dependencies = jsonObject.feed.entry["m:properties"]["d:Dependencies"].split('|')
        .map((p: string) => {
          var sp = p.split(':');
          return {
            dependencies: [
              {
                id: sp[0],
                range: sp[1],
              }
            ],
            targetFramework: sp[2]
          };
        });
      dependencies.forEach((dependencyGroup: any) => {
        let targetFramework = dependencyGroup.targetFramework;
        if (!packageDetails.dependencies.frameworks[targetFramework]) {
          packageDetails.dependencies.frameworks[targetFramework] = [];
        }
        dependencyGroup.dependencies?.forEach((dependency: any) => {
          packageDetails.dependencies.frameworks[targetFramework].push({
            package: dependency.id,
            versionRange: dependency.range,
          });
        });
        if (packageDetails.dependencies.frameworks[targetFramework].length === 0) {
          delete packageDetails.dependencies.frameworks[targetFramework];
        }
      });
    } catch (error) {
    }

    return { data: packageDetails };
  }

  private async ExecuteGet(
    url: string,
    config?: AxiosRequestConfig<any> | undefined
  ): Promise<AxiosResponse<any, any>> {
    const response = await this.http.get(url, config);
    if (response instanceof AxiosError) {
      console.error("Axios Error Data:");
      console.error(response.response?.data);
      // eslint-disable-next-line no-throw-literal
      throw {
        message: `${response.message} on request to${url}`,
      };
    }

    return response;
  }

  private getProxy(): AxiosProxyConfig | undefined {
    let proxy: string | undefined = vscode.workspace.getConfiguration().get("http.proxy");
    if (proxy === "" || proxy == undefined) {
      proxy =
        process.env["HTTPS_PROXY"] ??
        process.env["https_proxy"] ??
        process.env["HTTP_PROXY"] ??
        process.env["http_proxy"];
    }

    if (proxy && proxy !== "") {
      const proxy_url = new URL(proxy);

      console.info(`Found proxy: ${proxy}`);

      return {
        host: proxy_url.hostname,
        port: Number(proxy_url.port),
      };
    } else {
      return undefined;
    }
  }

  private async GetCredentials(): Promise<Credentials> {
    let credentialProviderFolder = _.trimEnd(
      _.trimEnd(this._credentialProviderFolder.replace("{user-profile}", os.homedir()), "/"),
      "\\"
    );

    let command = null;
    if (process.platform === "win32") {
      command = credentialProviderFolder + "\\CredentialProvider.Microsoft.exe";
    } else {
      command = `dotnet "${credentialProviderFolder}/CredentialProvider.Microsoft.dll"`;
    }
    try {
      let result = null;
      try {
        result = execSync(command + " -I -N -F Json -U " + this._url, {
          timeout: 10000,
        });
      } catch {
        let interactiveLoginTask = new vscode.Task(
          { type: "nuget", task: `CredentialProvider.Microsoft` },
          vscode.TaskScope.Workspace,
          "nuget-gallery-credentials",
          "CredentialProvider.Microsoft",
          new vscode.ProcessExecution(command, ["-C", "False", "-R", "-U", this._url])
        );

        await TaskExecutor.ExecuteTask(interactiveLoginTask);
        result = execSync(command + " -N -F Json -U " + this._url, {
          timeout: 10000,
        });
      }
      let parsedResult = JSON.parse(result) as {
        Username: string;
        Password: string;
      };
      return parsedResult;
    } catch (err) {
      console.error(err);
      // eslint-disable-next-line no-throw-literal
      throw {
        credentialProviderError: true,
        message: "Failed to fetch credentials. See 'Webview Developer Tools' for more details",
      };
    }
  }
}
