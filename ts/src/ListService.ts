/// <reference path="../../typings/tsd.d.ts" />
/// <reference path="RequestError.ts" />
/// <reference path="Helpers.ts" />

namespace SPListRepo{	
	export class ListService{
		private $ = jQuery;

		static getListByUrl(listUrl: string):JQueryPromise<SP.List>{			
			var loadDeferred = $.Deferred<SP.List>();
			
			var webAbsoluteUrl = SPListRepo.Helper.ensureTrailingSlash(_spPageContextInfo.webAbsoluteUrl);
			var webServerRelativeUrl = SPListRepo.Helper.ensureTrailingSlash(_spPageContextInfo.webServerRelativeUrl);
			var url = String.format("{0}_api/web/lists/?$expand=RootFolder&$filter=RootFolder/ServerRelativeUrl eq '{1}{2}'&$select=ID", webAbsoluteUrl, webServerRelativeUrl, listUrl);
			
			var context = SP.ClientContext.get_current();
			
			var success = function(list:SP.List){
				loadDeferred.resolve(list);			
			};
			
			var error = function(err:SPListRepo.RequestError){
				loadDeferred.reject(err);
			};
			
			if((<any>(context.get_web())).getList){ //Post Feb.2015 CU - getList() availiable
				var list = (<any>(context.get_web())).getList(String.format("{0}{1}", webServerRelativeUrl, listUrl)); 
				context.load(list);
				context.executeQueryAsync(function(){
					success(list);
				}, function(sender, err) { 
					error(new SPListRepo.RequestError(err));
				});
			}else{						//Pre Feb.2015 CU - getList missing
				ListService.getListUsingRest(url, success, error);
			}			
			
			return loadDeferred.promise();
		}
		
		static getListById(id: SP.Guid):JQueryPromise<SP.List>{
			var loadDeferred = $.Deferred<SP.List>();
			var context = SP.ClientContext.get_current();
			var list = context.get_web().get_lists().getById(id);
			context.load(list, "Title", "RootFolder", "Id");
			context.executeQueryAsync(function(){
				loadDeferred.resolve(list);
			}, function(sender, err) { 
				loadDeferred.reject(new SPListRepo.RequestError(err));
			});
			
			return loadDeferred.promise();
		}
				
		private static getListUsingRest(url:string, success:(lsit:SP.List) => void, error: (err:SPListRepo.RequestError) => void){
			$.ajax({
				url: url, 
				type: "GET",
				contentType: "application/json;odata=verbose",
				headers:{
					"Accept": "application/json;odata=verbose"
				},
				success: function(data){
					var context = SP.ClientContext.get_current();
					var list = context.get_web().get_lists().getById(data.d.results[0].Id);
					context.load(list);
					context.executeQueryAsync(function(){
						success(list);
					}, function(sender, e){
						error(new SPListRepo.RequestError(e));
					});
				},
				error: function(jqXHR, textStatus){
					error(new SPListRepo.RequestError(textStatus));
				}
			});
		}		
	}
}