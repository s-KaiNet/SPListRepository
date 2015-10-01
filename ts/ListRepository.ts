/// <reference path="../typings/tsd.d.ts" />
/// <reference path="ViewScope.ts" />
/// <reference path="Constants.ts" />
/// <reference path="ListService.ts" />
/// <reference path="BaseListItem.ts" />
/// <reference path="QuerySettings.ts" />

namespace SPListRepo{
	
	export interface IBaseItemConstruct<T extends BaseListItem> {
		new (item?: SP.ListItem): T;
	}
	
	export class ListRepository<T extends BaseListItem>{
		private _context: SP.ClientContext;
		private _loadListDeferred: JQueryPromise<SP.List>; 
		private _list: SP.List;
		private _listItemConstructor: IBaseItemConstruct<T>;
		
		folder: string;
		
		constructor(listUrlOrId: string|SP.Guid, listItemConstructor: IBaseItemConstruct<T>){
			
			this._listItemConstructor = listItemConstructor;
			this._context = SP.ClientContext.get_current();
			
			if(listUrlOrId instanceof SP.Guid){
				this._loadListDeferred = ListService.getListById(listUrlOrId);
				
			}else if(typeof listUrlOrId === "string"){
				this._loadListDeferred = ListService.getListByUrl(listUrlOrId);
			}
			
			this._loadListDeferred.done((list) => {
				this._list = list;
			})
			.fail((error:RequestError) => {
				alert(error.message);
			});
		}
		
		getItems(querySettings?: QuerySettings): JQueryPromise<T[]>{
			return this._getItemsByExpression(null, querySettings);
		}
		
		getItemById(id: number): JQueryPromise<T>{
			return this._withPromise<T>(deferred => {
				
				var item = this._list.getItemById(id);
				this._context.load(item);

				this._context.executeQueryAsync(() => {
					var resultItem = new this._listItemConstructor(item);
					deferred.resolve(resultItem);
				}, (sender, error) => {
					deferred.reject(new RequestError(error));
				});
			});
		}
		
		getItemsByTitle(title: string, querySettings?: QuerySettings): JQueryPromise<T[]>{
			var camlExpression = CamlBuilder.Expression().TextField("Title").EqualTo(title);
			
			return this._getItemsByExpression(camlExpression, querySettings);
		}
		
		getItemsByIds(ids: number[], querySettings?: QuerySettings): JQueryPromise<T[]>{
			var camlExpression = CamlBuilder.Expression().CounterField(Fields.ID).In(ids);

			return this._getItemsByExpression(camlExpression, querySettings);
		}
		
		getItemsInsideFolders(folderNames: string[], querySettings?: QuerySettings): JQueryPromise<T[]>{
			var camlExpression = CamlBuilder.Expression().TextField(Fields.FileDirRef).In(folderNames.map(folderName => {
				var folderRelUrl = this._getFolderRelativeUrl(folderName);
				if (folderRelUrl.indexOf("/") === 0) {
					folderRelUrl = folderRelUrl.substring(1);
				}

				return folderRelUrl;
			}));

			return this._getItemsByExpression(camlExpression, querySettings);
		}
		
		getLastAddedItem(viewFields?: string[], recursive: boolean = false): JQueryPromise<T>{
			var camlExpression = CamlBuilder.Expression().CounterField(Fields.ID).NotEqualTo(0);			
			var querySettings: QuerySettings;
			
			if(recursive){
				querySettings = new QuerySettings(ViewScope.FilesOnlyRecursive, viewFields, 1);
			}else{
				querySettings = new QuerySettings(ViewScope.FilesOnly, viewFields, 1);
			}
			
			var query = this._getSPCamlQuery(this._getViewQuery(camlExpression, querySettings).OrderByDesc(Fields.ID));

			return this._getItemBySPCamlQuery(query);
		}
		
		getLastModifiedItem(viewFields?: string[], recursive: boolean = false): JQueryPromise<T>{
			var camlExpression = CamlBuilder.Expression().CounterField(Fields.ID).NotEqualTo(0);			
			var querySettings: QuerySettings;
			
			if(recursive){
				querySettings = new QuerySettings(ViewScope.FilesOnlyRecursive, viewFields, 1);
			}else{
				querySettings = new QuerySettings(ViewScope.FilesOnly, viewFields, 1);
			}
			
			var query = this._getSPCamlQuery(this._getViewQuery(camlExpression, querySettings).OrderByDesc(Fields.Modified));

			return this._getItemBySPCamlQuery(query);
		}
		
		saveItem(model: T) : JQueryPromise<T>{
			if (!model.id || model.id < 1) {
				return this._addItem(model);
			}

			return this._updateItem(model);
		}
		
		deleteItem(model: T) : JQueryPromise<T>{
			return this._withPromise<T>(deferred => {
				
				var item = this._list.getItemById(model.id);
				this._context.load(item);

				item.deleteObject();

				this._context.executeQueryAsync(() => {
					deferred.resolve();
				}, (sender, error) => {
					deferred.reject(new RequestError(error));
				});
			});
		}
		
		createFolder(folderName: string): JQueryPromise<T>{
			return this._withPromise<T>(deferred => {
				
				var folder = new SP.ListItemCreationInformation();
				folder.set_underlyingObjectType(SP.FileSystemObjectType.folder);
				folder.set_leafName(folderName);
				var folderItem = this._list.addItem(folder);
				folderItem.set_item("Title", folderName);
				folderItem.update();
				var self = this;
				this._context.load(folderItem);
				this._context.executeQueryAsync(function () {
					var resultItem = new self._listItemConstructor(folderItem);
					deferred.resolve(resultItem);
				}, function (sender, error) {
					deferred.reject(new RequestError(error));
				});
			});
		}
		
		createFile(url: string, content: string, overwrite: boolean): JQueryPromise<SP.File>{
			return this._withPromise<SP.File>(deferred => {
				var fileCreateInfo = new SP.FileCreationInformation();
				
				fileCreateInfo.set_url(url);
				fileCreateInfo.set_overwrite(overwrite);
				fileCreateInfo.set_content(new SP.Base64EncodedByteArray());

				for (var i = 0; i < content.length; i++) {
					fileCreateInfo.get_content().append(content.charCodeAt(i));
				}
				
				var newFile = this._context.get_web().getFolderByServerRelativeUrl(this._getFolderRelativeUrl()).get_files().add(fileCreateInfo);
				this._context.load(newFile);
				
				this._context.executeQueryAsync(() => {
					deferred.resolve(newFile);
				}, (sender, error) => {
					deferred.reject(new RequestError(error));
				});
			});
		}
		
		private _getItemBySPCamlQuery(spCamlQuery: SP.CamlQuery): JQueryPromise<T>{
			var deferred = this._createDeferred();

			this._getItemsBySPCamlQuery(spCamlQuery)
			.done(items => {
				if (items.length > 1) throw "Result contains more than one element";
				
				deferred.resolve(items.length === 1 ? items[0] : null);
			})
			.fail(err => {
				deferred.reject(err);
			});
			
			return deferred.promise();
		}
		
		private _addItem(model: T): JQueryPromise<T>{
			return this._withPromise(deferred => {
			
			var itemCreateInfo = new SP.ListItemCreationInformation();
				if (this.folder) {
					itemCreateInfo.set_folderUrl(this._getFolderRelativeUrl());
				}
				var newItem = this._list.addItem(itemCreateInfo);
				
				model.mapToListItem(newItem);
				
				var self = this;

				newItem.update();
				this._context.load(newItem);

				this._context.executeQueryAsync(function () {
					var resultItem = new self._listItemConstructor(newItem);
					deferred.resolve(resultItem);
				}, function (sender, error) {
					deferred.reject(new RequestError(error)); 
				});
			});
		}
		
		private _updateItem(model: T): JQueryPromise<T>{
			return this._withPromise<T>(deferred => {
				
				var item = this._list.getItemById(model.id);
				this._context.load(item);
				
				model.mapToListItem(item);

				var self = this;

				item.update();

				this._context.executeQueryAsync(function () {
					var resultItem = new self._listItemConstructor(item);
					deferred.resolve(resultItem);
				}, function (sender, args) {
					deferred.reject(new RequestError(args));
				});
			});
		}
		
		private _getItemsByExpression(camlExpression: CamlBuilder.IExpression, querySettings?: QuerySettings) : JQueryPromise<T[]>{
			querySettings = querySettings || new QuerySettings(ViewScope.FilesFolders);
			
			var camlQuery = this._getSPCamlQuery(this._getViewQuery(camlExpression, querySettings));
			
			return this._getItemsBySPCamlQuery(camlQuery);
		}
		
		private _getViewQuery(camlExpression: CamlBuilder.IExpression, querySettings: QuerySettings) : CamlBuilder.IExpression{
			var camlQuery;
			var viewQuery = new CamlBuilder().View(querySettings.viewFields);
			
			if(querySettings.rowLimit){
				viewQuery = viewQuery.RowLimit(querySettings.rowLimit);
			}
			var foldersOnlyExpression = CamlBuilder.Expression().IntegerField(Fields.FSObjType).EqualTo(1);
			switch (querySettings.viewScope)
			{
				case ViewScope.FilesOnly: 
					viewQuery = viewQuery.Scope(CamlBuilder.ViewScope.FilesOnly);
					break;
				case ViewScope.FoldersOnly: 
				case ViewScope.FilesFolders: 
					break;
				case ViewScope.FilesOnlyRecursive: 
					viewQuery = viewQuery.Scope(CamlBuilder.ViewScope.Recursive);
					break;
				case ViewScope.FoldersOnlyRecursive: 
				case ViewScope.FilesFoldersRecursive: 
					viewQuery = viewQuery.Scope(CamlBuilder.ViewScope.RecursiveAll);
					break;
				default: 
					viewQuery = viewQuery.Scope(CamlBuilder.ViewScope.RecursiveAll);
					break;
			}
			
			if(querySettings.viewScope === ViewScope.FoldersOnly || querySettings.viewScope === ViewScope.FoldersOnlyRecursive){
				if(camlExpression){
					camlQuery = viewQuery.Query().Where().All(camlExpression, foldersOnlyExpression);
				} else {
					camlQuery = viewQuery.Query().Where().All(foldersOnlyExpression);
				}
			}
			else{
				if(camlExpression){
					camlQuery = viewQuery.Query().Where().All(camlExpression);
				} else {
					camlQuery = viewQuery.Query().Where().All();
				}
			}			
				
			return camlQuery;
		}
		
		private _getSPCamlQuery(viewXmlObject: CamlBuilder.IFinalizable): SP.CamlQuery{
			var viewQuery = viewXmlObject.ToString();
			console.log("Running query:");
			console.log(viewQuery);
			var query = new SP.CamlQuery();
			query.set_viewXml(viewQuery);			
			return query;
		}
		
		private _getItemsBySPCamlQuery(spCamlQuery: SP.CamlQuery): JQueryPromise<T[]>{
			return this._withPromise<T[]>(deferred => {
				if (this.folder) {
					spCamlQuery.set_folderServerRelativeUrl(this._getFolderRelativeUrl());
				}
				var items = this._list.getItems(spCamlQuery);
				this._context.load(items);

				var self = this;

				this._context.executeQueryAsync(function () {
					var itemsEnumerator = items.getEnumerator();
					var resultItemList: T[] = [];

					while (itemsEnumerator.moveNext()) {
						resultItemList.push(new self._listItemConstructor(itemsEnumerator.get_current()));
					}

					deferred.resolve(resultItemList);

				}, function (sender, args) {
					deferred.reject(new RequestError(args));
				});
			});
		}
		
		private _getFolderRelativeUrl(folderName?: string) : string{
			var folder = folderName || this.folder;

			var listRootUrl = this._list.get_rootFolder().get_serverRelativeUrl();
			listRootUrl = Helper.ensureTrailingSlash(listRootUrl);
	
			return String.format("{0}{1}", listRootUrl, folder);
		}
		
		private _createDeferred<T>(){
			return jQuery.Deferred<T>();
		}
		
		private _withPromise<U>(callback: (deferred: JQueryDeferred<U>) => void): JQueryPromise<U>{
			var deferred = this._createDeferred<U>();
			this._loadListDeferred.done(() => {				
				callback(deferred);
			});
			
			return deferred.promise();
		}
	}
}