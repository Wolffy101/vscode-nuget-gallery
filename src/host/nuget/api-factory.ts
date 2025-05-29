import * as vscode from "vscode";
import NuGetApi from "../nuget/api";
import NuGetApiV2 from "./apiv2";

type SourceApiCollection = {
  [url: string]: NuGetApi | NuGetApiV2;
};

class NuGetApiFactory {
  private readonly _sourceApiCollection: SourceApiCollection = {};

  public GetSourceApi(url: string) {
    let credentialProviderFolder =
      vscode.workspace.getConfiguration("NugetGallery").get<string>("credentialProviderFolder") ??
      "";
    if (!(url in this._sourceApiCollection))
      if (url.endsWith("index.json")) {
        this._sourceApiCollection[url] = new NuGetApi(url, credentialProviderFolder);
      } else {
        this._sourceApiCollection[url] = new NuGetApiV2(url, credentialProviderFolder);
      }

    return this._sourceApiCollection[url];
  }
}

export default new NuGetApiFactory();
