import * as vscode from "vscode";
import { IRequestHandler } from "../../common/messaging/core/types";
import ProjectParser from "../utilities/project-parser";

export class GetProjects
  implements IRequestHandler<GetProjectsRequest, GetProjectsResponse>
{
  async HandleAsync(request: GetProjectsRequest): Promise<GetProjectsResponse> {
    let projectFiles = await vscode.workspace.findFiles(
      "**/*.{csproj,fsproj,vbproj}",
      "**/node_modules/**"
    );
    let response: GetProjectsResponse = {
      Projects: await ProjectParser.GetProjectsAsync(
        projectFiles.map((p) => p.fsPath)
      ),
    };
    return response;
  }
}
